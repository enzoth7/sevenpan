import { createClient } from '@supabase/supabase-js'
import type { Database } from './lib/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://cyeagsxabemiovjngrwa.supabase.co'
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_6OEdPg3jTkIz809vSAdssw_MKq7J7Jw'

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

export async function getMyProfile(userId: string) {
  const data = await throwIfError(await supabase
    .from('profiles')
    .select('id, role, customer_id, full_name')
    .eq('id', userId)
    .single())
  return data
}

export async function loadWorkspace(profile: { role: 'admin' | 'customer'; customer_id: string | null }) {
  const products = supabase.from('products').select('*').order('name')
  const customers = profile.role === 'admin'
    ? supabase.from('customers').select('*').order('name')
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

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function apiRequest(path: string, options: { method?: string; body?: unknown } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Tu sesión expiró. Ingresá nuevamente.')

  const response = await fetch(`${supabaseUrl}/functions/v1/${path.replace(/^\//, '')}`, {
    method: options.method || 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: supabasePublishableKey,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No pudimos completar la operación.')
  return payload
}

export function subscribeToCatalog(onChange: () => void) {
  const channel = supabase
    .channel('catalog-prices')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
    .subscribe()

  return () => supabase.removeChannel(channel)
}
