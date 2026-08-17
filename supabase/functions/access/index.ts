import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { z } from 'npm:zod@3.24.2'
import {
  errorResponse, HttpError, optionsResponse, parseBody, requestPath, respond, serviceClient,
} from '../_shared/api.ts'
import {
  ACCESS_CODE_PATTERN, hashAccessCode, normalizeAccessCode, sha256,
} from '../_shared/accessCode.ts'

const accessSchema = z.object({
  accessCode: z.string().min(12).max(32).transform(normalizeAccessCode)
    .refine((value) => ACCESS_CODE_PATTERN.test(value)),
  password: z.string().min(8).max(72),
})

const GENERIC_CODE_ERROR = 'El código temporal no es válido, venció o ya fue utilizado.'

function clientAddress(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || 'unknown'
}

function randomPassword() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function registerAttempt(
  service: ReturnType<typeof serviceClient>,
  request: Request,
  secretHash: string,
  purpose: 'activation' | 'recovery',
) {
  const requestFingerprint = await sha256([
    clientAddress(request), secretHash, purpose,
  ].join('|'))
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  await service
    .from('customer_access_attempts')
    .delete()
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const { count, error: countError } = await service
    .from('customer_access_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('request_fingerprint', requestFingerprint)
    .gte('created_at', windowStart)
  if (countError) throw countError
  if ((count || 0) >= 5) {
    throw new HttpError(429, 'Demasiados intentos. Esperá 15 minutos antes de volver a probar.')
  }

  const { data, error } = await service
    .from('customer_access_attempts')
    .insert({ request_fingerprint: requestFingerprint })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function completeAccess(
  request: Request,
  purpose: 'activation' | 'recovery',
) {
  const input = await parseBody(request, accessSchema)
  const service = serviceClient()
  const secretHash = await hashAccessCode(input.accessCode)
  const attemptId = await registerAttempt(service, request, secretHash, purpose)
  const { data, error } = await service.rpc('redeem_customer_access_code', {
    p_secret_hash: secretHash,
    p_purpose: purpose,
  })
  if (error) throw error

  const redeemed = Array.isArray(data) ? data[0] : data
  if (!redeemed?.profile_id || !redeemed?.challenge_id) {
    throw new HttpError(422, GENERIC_CODE_ERROR)
  }

  const { error: passwordError } = await service.auth.admin.updateUserById(
    redeemed.profile_id,
    { password: input.password },
  )
  if (passwordError) {
    await service.from('customer_activation_challenges')
      .update({ used_at: null })
      .eq('id', redeemed.challenge_id)
      .eq('profile_id', redeemed.profile_id)
      .gt('expires_at', new Date().toISOString())
    console.error('manual access password update failed', passwordError)
    throw new HttpError(500, 'No pudimos guardar la contraseña. Intentá nuevamente.')
  }

  if (purpose === 'activation') {
    const { data: activated, error: activationError } = await service
      .from('profiles')
      .update({ access_status: 'active', activated_at: new Date().toISOString() })
      .eq('id', redeemed.profile_id)
      .eq('role', 'customer')
      .eq('access_status', 'pending')
      .select('id')
      .maybeSingle()
    if (activationError || !activated) {
      await service.auth.admin.updateUserById(redeemed.profile_id, { password: randomPassword() })
      await service.from('customer_activation_challenges')
        .update({ used_at: null })
        .eq('id', redeemed.challenge_id)
        .eq('profile_id', redeemed.profile_id)
        .gt('expires_at', new Date().toISOString())
      if (activationError) console.error('manual access profile activation failed', activationError)
      throw new HttpError(500, 'No pudimos activar la cuenta. Intentá nuevamente.')
    }
  }

  await service.from('customer_access_attempts')
    .update({ successful: true })
    .eq('id', attemptId)

  return respond({ completed: true, mode: purpose, email: redeemed.contact_email })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse()

  try {
    const path = requestPath(request, 'access')
    if (request.method === 'POST' && path === '/activation/complete') {
      return await completeAccess(request, 'activation')
    }
    if (request.method === 'POST' && path === '/recovery/complete') {
      return await completeAccess(request, 'recovery')
    }
    return respond({ error: 'Ruta no encontrada.' }, 404)
  } catch (error) {
    return errorResponse(error)
  }
})
