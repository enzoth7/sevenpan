import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.112.2'
import { ZodError, type ZodType } from 'npm:zod@3.24.2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

export function optionsResponse() {
  return new Response('ok', { headers: corsHeaders })
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return respond({ error: error.message }, error.status)
  if (error instanceof ZodError) return respond({ error: 'Los datos enviados no son válidos.' }, 400)

  const databaseError = error as { code?: string; message?: string }
  if (databaseError?.code === '42501') return respond({ error: databaseError.message || 'No tenés permisos para esta acción.' }, 403)
  if (databaseError?.code === '23505') return respond({ error: 'Ya existe un registro con esos datos.' }, 409)
  if (databaseError?.code === 'P0001') return respond({ error: databaseError.message || 'La operación no está permitida.' }, 422)

  console.error(error)
  return respond({ error: 'No pudimos procesar la solicitud.' }, 500)
}

function projectUrl() {
  const value = Deno.env.get('SUPABASE_URL')
  if (!value) throw new HttpError(500, 'Falta la configuración de Supabase.')
  return value
}

function publishableKey() {
  const value = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  if (!value) throw new HttpError(500, 'Falta la clave pública de Supabase.')
  return value
}

export async function userClient(request: Request): Promise<{ client: SupabaseClient; user: User }> {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'Necesitás iniciar sesión.')

  const client = createClient(projectUrl(), publishableKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authorization.slice('Bearer '.length)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'La sesión no es válida.')

  return { client, user: data.user }
}

export function serviceClient() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key) throw new HttpError(500, 'Falta la configuración segura de invitaciones.')
  return createClient(projectUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function requireAdmin(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  if (error || data?.role !== 'admin') throw new HttpError(403, 'Solo un administrador puede realizar esta acción.')
}

export async function parseBody<T>(request: Request, schema: ZodType<T>) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'El cuerpo de la solicitud debe ser JSON válido.')
  }
  return schema.parse(body)
}

export function requestPath(request: Request, functionName: string) {
  const pathname = new URL(request.url).pathname
  const marker = `/${functionName}`
  const index = pathname.indexOf(marker)
  return index < 0 ? '/' : pathname.slice(index + marker.length) || '/'
}
