import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { z } from 'npm:zod@3.24.2'
import { errorResponse, HttpError, optionsResponse, parseBody, requestPath, requireAdmin, respond, serviceClient, userClient } from '../_shared/api.ts'

const productSchema = z.object({
  price: z.number().nonnegative().max(10000000).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => value.price !== undefined || value.isActive !== undefined, {
  message: 'Indicá un precio o disponibilidad para actualizar.',
})

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  detail: z.string().trim().min(2).max(240),
  price: z.number().nonnegative().max(10000000),
  unit: z.enum(['kg', 'unidad', 'docena']),
  category: z.enum(['Panificados', 'Pastelería', 'Especialidades']),
})

const statusSchema = z.object({
  status: z.enum(['delivered', 'cancelled']),
})

const inviteSchema = z.object({
  email: z.string().email().max(255),
  contactName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(80),
  addressLine1: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(40),
  deliveryNotes: z.string().trim().max(500).nullable().optional(),
})

const idSchema = z.string().uuid()
const productIdSchema = z.string().regex(/^[a-z0-9-]+$/)

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]).join('').toUpperCase()
}

function productSlug(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse()

  try {
    const { client, user } = await userClient(request)
    await requireAdmin(client, user.id)
    const path = requestPath(request, 'admin')

    if (request.method === 'POST' && path === '/products') {
      const input = await parseBody(request, createProductSchema)
      const baseId = productSlug(input.name)
      if (!baseId) throw new HttpError(400, 'El nombre no permite generar un identificador válido.')
      const { data: existing, error: lookupError } = await client.from('products').select('id').eq('id', baseId).maybeSingle()
      if (lookupError) throw lookupError
      const id = existing ? `${baseId}-${crypto.randomUUID().slice(0, 8)}` : baseId
      const { data, error } = await client.from('products').insert({ ...input, id, tone: 'sand', is_active: true }).select().single()
      if (error) throw error
      return respond({ product: data }, 201)
    }

    const productMatch = path.match(/^\/products\/([^/]+)$/)
    if (request.method === 'PATCH' && productMatch) {
      const productId = productIdSchema.parse(productMatch[1])
      const input = await parseBody(request, productSchema)
      const update = {
        ...(input.price === undefined ? {} : { price: input.price }),
        ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
      }
      const { data, error } = await client.from('products').update(update).eq('id', productId).select().single()
      if (error) throw error
      return respond({ product: data })
    }

    const statusMatch = path.match(/^\/orders\/([^/]+)\/status$/)
    if (request.method === 'PATCH' && statusMatch) {
      const orderId = idSchema.parse(statusMatch[1])
      const input = await parseBody(request, statusSchema)
      const { error } = await serviceClient().rpc('advance_order_status', {
        p_actor_id: user.id,
        p_order_id: orderId,
        p_next_status: input.status,
      })
      if (error) throw error
      return respond({ id: orderId, status: input.status })
    }

    if (request.method === 'POST' && path === '/customers/invite') {
      const input = await parseBody(request, inviteSchema)
      const service = serviceClient()
      const { data: duplicate } = await service.from('customers').select('id').eq('slug', input.slug).maybeSingle()
      if (duplicate) throw new HttpError(409, 'Ya existe una panadería con ese identificador.')

      const { data: customer, error: customerError } = await service
        .from('customers')
        .insert({
          name: input.name,
          slug: input.slug,
          initials: initials(input.name),
          location: input.city,
          address_line_1: input.addressLine1,
          city: input.city,
          phone: input.phone,
          delivery_notes: input.deliveryNotes || null,
          is_active: true,
        })
        .select()
        .single()
      if (customerError) throw customerError

      const { data: invitation, error: invitationError } = await service.auth.admin.inviteUserByEmail(input.email, {
        data: { full_name: input.contactName },
      })
      if (invitationError || !invitation.user) {
        await service.from('customers').delete().eq('id', customer.id)
        throw invitationError ?? new HttpError(500, 'No pudimos crear la invitación.')
      }

      const { error: profileError } = await service.from('profiles').insert({
        id: invitation.user.id,
        role: 'customer',
        customer_id: customer.id,
        full_name: input.contactName,
      })
      if (profileError) {
        await service.auth.admin.deleteUser(invitation.user.id)
        await service.from('customers').delete().eq('id', customer.id)
        throw profileError
      }

      return respond({ customer }, 201)
    }

    return respond({ error: 'Ruta no encontrada.' }, 404)
  } catch (error) {
    return errorResponse(error)
  }
})
