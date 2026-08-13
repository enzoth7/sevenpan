import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { z } from 'npm:zod@3.24.2'
import { errorResponse, HttpError, optionsResponse, parseBody, respond, userClient } from '../_shared/api.ts'

const profileSchema = z.object({
  addressLine1: z.string().trim().min(3).max(160).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(6).max(40).optional(),
  deliveryNotes: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: 'Indicá al menos un dato para actualizar.',
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse()

  try {
    const { client, user } = await userClient(request)
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('customer_id, role')
      .eq('id', user.id)
      .single()
    if (profileError || profile?.role !== 'customer' || !profile.customer_id) {
      throw new HttpError(403, 'Esta cuenta no está asociada a una panadería cliente.')
    }
    const customerId = profile.customer_id

    if (request.method === 'GET') {
      const { data, error } = await client.from('customers').select('*').eq('id', customerId).single()
      if (error) throw error
      return respond({ customer: data })
    }

    if (request.method === 'PATCH') {
      const input = await parseBody(request, profileSchema)
      const { data, error } = await client
        .from('customers')
        .update({
          ...(input.addressLine1 === undefined ? {} : { address_line_1: input.addressLine1 }),
          ...(input.city === undefined ? {} : { city: input.city }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.deliveryNotes === undefined ? {} : { delivery_notes: input.deliveryNotes || null }),
        })
        .eq('id', customerId)
        .select()
        .single()
      if (error) throw error
      return respond({ customer: data })
    }

    return respond({ error: 'Método no permitido.' }, 405)
  } catch (error) {
    return errorResponse(error)
  }
})
