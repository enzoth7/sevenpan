import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { z } from 'npm:zod@3.24.2'
import { errorResponse, optionsResponse, parseBody, requestPath, respond, serviceClient, userClient } from '../_shared/api.ts'

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive().max(10000),
})

const orderSchema = z.object({
  items: z.array(itemSchema).min(1),
  deliveryDate: z.string().date().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

const orderIdSchema = z.string().uuid()

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse()

  try {
    const { user } = await userClient(request)
    const service = serviceClient()
    const path = requestPath(request, 'orders')

    if (request.method === 'POST' && path === '/') {
      const input = await parseBody(request, orderSchema)
      const { data, error } = await service.rpc('place_order', {
        p_actor_id: user.id,
        p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
        p_delivery_date: input.deliveryDate ?? null,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
      return respond({ id: data }, 201)
    }

    const orderId = orderIdSchema.parse(path.replace(/^\//, ''))
    if (request.method === 'PATCH') {
      const input = await parseBody(request, orderSchema)
      const { data, error } = await service.rpc('update_pending_order', {
        p_actor_id: user.id,
        p_order_id: orderId,
        p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
        p_delivery_date: input.deliveryDate ?? null,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
      return respond({ id: data })
    }

    if (request.method === 'DELETE') {
      const { error } = await service.rpc('cancel_pending_order', {
        p_actor_id: user.id,
        p_order_id: orderId,
      })
      if (error) throw error
      return respond({ id: orderId, status: 'cancelled' })
    }

    return respond({ error: 'Método no permitido.' }, 405)
  } catch (error) {
    return errorResponse(error)
  }
})
