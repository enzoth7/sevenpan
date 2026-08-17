import { createClient } from '@supabase/supabase-js'
import type { Database } from './lib/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://cyeagsxabemiovjngrwa.supabase.co'
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_6OEdPg3jTkIz809vSAdssw_MKq7J7Jw'
const functionsBaseUrl = `${supabaseUrl}/functions/v1`

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

function normalizeOrder(row: any) {
  const items = (row.items || []).map((item: any) => ({
    ...item,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
  }))

  return {
    ...row,
    items,
    total: items.reduce((sum: number, item: any) => sum + item.quantity * item.unit_price, 0),
    totalKg: items.reduce((sum: number, item: any) => sum + (item.product?.unit === 'kg' ? item.quantity : 0), 0),
  }
}

async function throwIfError<T>({ data, error }: { data: T; error: unknown }) {
  if (error) throw error
  return data
}

async function readFunctionResponse(response: Response) {
  const raw = await response.text()
  let payload: Record<string, any> = {}
  try { payload = raw ? JSON.parse(raw) : {} } catch { payload = {} }
  const plainText = raw.trim() && !raw.trim().startsWith('<') ? raw.trim().slice(0, 240) : ''
  const message = payload.error || payload.message || payload.msg || plainText
  return { payload, message }
}

export async function getMyProfile(userId: string) {
  const data = await throwIfError(await supabase
    .from('profiles')
    .select('id, role, customer_id, full_name, contact_email, contact_phone, access_status, activated_at, customer:customers(is_active)')
    .eq('id', userId)
    .single())
  return data
}

export async function loadWorkspace(profile: { role: 'admin' | 'customer'; customer_id: string | null }) {
  const products = supabase.from('products').select('*').order('name')
  const customers = profile.role === 'admin'
    ? supabase.from('customers').select('*, members:profiles(id, full_name, contact_email, contact_phone, access_status, activated_at, created_at)').is('archived_at', null).order('name')
    : supabase.from('customers').select('*').eq('id', profile.customer_id || '').single()
  const orders = supabase
    .from('orders')
    .select('id, customer_id, order_number, status, delivery_date, notes, created_at, updated_at, cancelled_at, customer:customers(id, slug, name, initials, location, color, address_line_1, city, phone, delivery_notes), items:order_items(product_id, quantity, unit_price, product:products(id, name, unit))')
    .order('created_at', { ascending: false })

  const [productsResult, customersResult, ordersResult] = await Promise.all([products, customers, orders])
  const productRows = await throwIfError(productsResult)
  const customerRows = await throwIfError(customersResult)
  const orderRows = await throwIfError(ordersResult)

  return {
    products: productRows || [],
    customers: profile.role === 'admin' ? customerRows || [] : [customerRows].filter(Boolean),
    orders: (orderRows || []).map(normalizeOrder),
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({
    current_password: currentPassword,
    password: newPassword,
  })
  if (error) throw error
  return data.user
}

async function accessRequest(path: string, body: unknown) {
  const headers: Record<string, string> = {
    apikey: supabasePublishableKey,
    'Content-Type': 'application/json',
  }
  const response = await fetch(`${functionsBaseUrl}/access/${path.replace(/^\//, '')}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const { payload, message } = await readFunctionResponse(response)
  if (!response.ok) throw new Error(message || `No pudimos completar la verificación (HTTP ${response.status}).`)
  return payload
}

export async function completeManualAccess(
  mode: 'activation' | 'recovery',
  accessCode: string,
  password: string,
) {
  return accessRequest(`${mode}/complete`, { accessCode, password }) as Promise<{ completed: true; mode: 'activation' | 'recovery'; email: string }>
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function apiRequest(path: string, options: { method?: string; body?: unknown } = {}) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!session) throw new Error('Tu sesión expiró. Ingresá nuevamente.')

  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  const invoke = (accessToken: string) => fetch(`${functionsBaseUrl}/${path.replace(/^\//, '')}`, {
    method: options.method || 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabasePublishableKey,
      'Content-Type': 'application/json',
    },
    body,
  })

  let response = await invoke(session.access_token)
  if (response.status === 401) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) throw new Error('Tu sesión expiró. Cerrá sesión e ingresá nuevamente.')
    response = await invoke(data.session.access_token)
  }

  const { payload, message } = await readFunctionResponse(response)
  if (!response.ok) throw new Error(message || `No pudimos completar la operación (HTTP ${response.status}).`)
  return payload
}

export function subscribeToCatalog(onChange: () => void) {
  const channel = supabase
    .channel('catalog-prices')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
    .subscribe()

  return () => supabase.removeChannel(channel)
}
