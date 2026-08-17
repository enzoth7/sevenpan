import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { z } from 'npm:zod@3.24.2'
import { errorResponse, HttpError, optionsResponse, parseBody, requestPath, requireAdmin, respond, serviceClient, userClient } from '../_shared/api.ts'
import { generateAccessCode, hashAccessCode } from '../_shared/accessCode.ts'

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

const customerSchema = z.object({
  customerCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/),
  contactEmail: z.string().trim().toLowerCase().email().max(255),
  contactPhone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/),
  contactName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  addressLine1: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(80),
  businessPhone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
  deliveryNotes: z.string().trim().max(500).nullable().optional(),
})

const accessSchema = z.object({
  contactEmail: z.string().trim().toLowerCase().email().max(255),
  contactPhone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/),
  contactName: z.string().trim().min(2).max(120),
})

const customerStatusSchema = z.object({ isActive: z.boolean() })

const idSchema = z.string().uuid()
const productIdSchema = z.string().regex(/^[a-z0-9-]+$/)

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]).join('').toUpperCase()
}

function productSlug(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function availableCustomerSlug(service: ReturnType<typeof serviceClient>, name: string) {
  const base = productSlug(name) || 'cliente'
  const { data, error } = await service.from('customers').select('slug').like('slug', `${base}%`)
  if (error) throw error
  const used = new Set((data || []).map((item) => item.slug))
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

async function issueAccessCode(
  service: ReturnType<typeof serviceClient>,
  profileId: string,
  purpose: 'activation' | 'recovery',
  issuedBy: string,
) {
  const accessCode = generateAccessCode()
  const secretHash = await hashAccessCode(accessCode)
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  const { error: invalidateError } = await service
    .from('customer_activation_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .eq('purpose', purpose)
    .is('used_at', null)
  if (invalidateError) throw invalidateError

  const { error } = await service.from('customer_activation_challenges').insert({
    profile_id: profileId,
    secret_hash: secretHash,
    request_fingerprint: null,
    purpose,
    issued_by: issuedBy,
    expires_at: expiresAt,
  })
  if (error) throw error

  return { accessCode, accessCodePurpose: purpose, accessCodeExpiresAt: expiresAt }
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

    if (request.method === 'POST' && path === '/customers') {
      const input = await parseBody(request, customerSchema)
      const service = serviceClient()
      const { data: duplicate } = await service.from('customers').select('id').eq('customer_code', input.customerCode).maybeSingle()
      if (duplicate) throw new HttpError(409, 'Ya existe una panadería con ese código.')
      const slug = await availableCustomerSlug(service, input.name)

      const { data: customer, error: customerError } = await service
        .from('customers')
        .insert({
          name: input.name,
          slug,
          customer_code: input.customerCode,
          initials: initials(input.name),
          location: input.city,
          address_line_1: input.addressLine1,
          city: input.city,
          phone: input.businessPhone || input.contactPhone,
          delivery_notes: input.deliveryNotes || null,
          is_active: true,
        })
        .select()
        .single()
      if (customerError) throw customerError

      const { data: createdUser, error: userError } = await service.auth.admin.createUser({
        email: input.contactEmail,
        email_confirm: true,
        user_metadata: { full_name: input.contactName },
      })
      if (userError || !createdUser.user) {
        await service.from('customers').delete().eq('id', customer.id)
        if (userError?.message?.toLowerCase().includes('already')) throw new HttpError(409, 'Ese correo ya tiene una cuenta asignada.')
        throw userError ?? new HttpError(500, 'No pudimos crear el acceso.')
      }

      const { data: access, error: profileError } = await service.from('profiles').insert({
        id: createdUser.user.id,
        role: 'customer',
        customer_id: customer.id,
        full_name: input.contactName,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        access_status: 'pending',
        activated_at: null,
      }).select('id, full_name, contact_email, contact_phone, access_status, activated_at').single()
      if (profileError) {
        await service.auth.admin.deleteUser(createdUser.user.id)
        await service.from('customers').delete().eq('id', customer.id)
        throw profileError
      }

      try {
        const issuedCode = await issueAccessCode(service, access.id, 'activation', user.id)
        return respond({ customer, access, ...issuedCode }, 201)
      } catch (codeError) {
        await service.auth.admin.deleteUser(createdUser.user.id)
        await service.from('customers').delete().eq('id', customer.id)
        throw codeError
      }
    }

    const accessMatch = path.match(/^\/customers\/([^/]+)\/access$/)
    if (request.method === 'PATCH' && accessMatch) {
      const customerId = idSchema.parse(accessMatch[1])
      const input = await parseBody(request, accessSchema)
      const service = serviceClient()
      const { data: current, error: currentError } = await service
        .from('profiles')
        .select('id, full_name, contact_email, contact_phone, access_status, activated_at')
        .eq('customer_id', customerId)
        .eq('role', 'customer')
        .neq('access_status', 'suspended')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (currentError) throw currentError
      if (!current) throw new HttpError(404, 'No encontramos el acceso principal de este cliente.')

      if (current.contact_email === input.contactEmail) {
        const { error: authError } = await service.auth.admin.updateUserById(current.id, {
          user_metadata: { full_name: input.contactName },
        })
        if (authError) throw authError
        const { data: access, error } = await service.from('profiles').update({
          full_name: input.contactName,
          contact_phone: input.contactPhone,
        }).eq('id', current.id).select('id, full_name, contact_email, contact_phone, access_status, activated_at').single()
        if (error) {
          await service.auth.admin.updateUserById(current.id, {
            user_metadata: { full_name: current.full_name },
          })
          throw error
        }
        return respond({ access })
      }

      if (current.access_status === 'pending') {
        const { error: authError } = await service.auth.admin.updateUserById(current.id, {
          email: input.contactEmail,
          email_confirm: true,
          user_metadata: { full_name: input.contactName },
        })
        if (authError) {
          if (authError.message?.toLowerCase().includes('already')) throw new HttpError(409, 'Ese correo ya tiene una cuenta asignada.')
          throw authError
        }
        await service.from('customer_activation_challenges').delete().eq('profile_id', current.id)
        const { data: access, error } = await service.from('profiles').update({
          full_name: input.contactName,
          contact_email: input.contactEmail,
          contact_phone: input.contactPhone,
        }).eq('id', current.id).select('id, full_name, contact_email, contact_phone, access_status, activated_at').single()
        if (error) {
          await service.auth.admin.updateUserById(current.id, {
            email: current.contact_email,
            email_confirm: true,
            user_metadata: { full_name: current.full_name },
          })
          throw error
        }
        try {
          const issuedCode = await issueAccessCode(service, current.id, 'activation', user.id)
          return respond({ access, ...issuedCode })
        } catch (codeError) {
          await service.from('profiles').update({
            full_name: current.full_name,
            contact_email: current.contact_email,
            contact_phone: current.contact_phone,
          }).eq('id', current.id)
          await service.auth.admin.updateUserById(current.id, {
            email: current.contact_email,
            email_confirm: true,
            user_metadata: { full_name: current.full_name },
          })
          throw codeError
        }
      }

      const { data: replacement, error: replacementError } = await service.auth.admin.createUser({
        email: input.contactEmail,
        email_confirm: true,
        user_metadata: { full_name: input.contactName },
      })
      if (replacementError || !replacement.user) {
        if (replacementError?.message?.toLowerCase().includes('already')) throw new HttpError(409, 'Ese correo ya tiene una cuenta asignada.')
        throw replacementError ?? new HttpError(500, 'No pudimos crear el nuevo acceso.')
      }

      const { error: suspendError } = await service.from('profiles').update({ access_status: 'suspended' }).eq('id', current.id)
      if (suspendError) {
        await service.auth.admin.deleteUser(replacement.user.id)
        throw suspendError
      }
      const { data: access, error: insertError } = await service.from('profiles').insert({
        id: replacement.user.id,
        role: 'customer',
        customer_id: customerId,
        full_name: input.contactName,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        access_status: 'pending',
        activated_at: null,
      }).select('id, full_name, contact_email, contact_phone, access_status, activated_at').single()
      if (insertError) {
        await service.from('profiles').update({ access_status: current.access_status }).eq('id', current.id)
        await service.auth.admin.deleteUser(replacement.user.id)
        throw insertError
      }
      try {
        const issuedCode = await issueAccessCode(service, access.id, 'activation', user.id)
        return respond({ access, ...issuedCode })
      } catch (codeError) {
        await service.from('profiles').delete().eq('id', replacement.user.id)
        await service.from('profiles').update({ access_status: current.access_status }).eq('id', current.id)
        await service.auth.admin.deleteUser(replacement.user.id)
        throw codeError
      }
    }

    const codeMatch = path.match(/^\/customers\/([^/]+)\/access-code$/)
    if (request.method === 'POST' && codeMatch) {
      const customerId = idSchema.parse(codeMatch[1])
      const service = serviceClient()
      const { data: access, error } = await service
        .from('profiles')
        .select('id, access_status')
        .eq('customer_id', customerId)
        .eq('role', 'customer')
        .neq('access_status', 'suspended')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!access) throw new HttpError(404, 'No encontramos un acceso habilitado para este cliente.')

      const purpose = access.access_status === 'pending' ? 'activation' : 'recovery'
      const issuedCode = await issueAccessCode(service, access.id, purpose, user.id)
      return respond(issuedCode, 201)
    }

    const customerStatusMatch = path.match(/^\/customers\/([^/]+)\/status$/)
    if (request.method === 'PATCH' && customerStatusMatch) {
      const customerId = idSchema.parse(customerStatusMatch[1])
      const input = await parseBody(request, customerStatusSchema)
      const { data, error } = await serviceClient()
        .from('customers')
        .update({ is_active: input.isActive })
        .eq('id', customerId)
        .select()
        .single()
      if (error) throw error
      return respond({ customer: data })
    }

    const customerDeleteMatch = path.match(/^\/customers\/([^/]+)$/)
    if (request.method === 'DELETE' && customerDeleteMatch) {
      const customerId = idSchema.parse(customerDeleteMatch[1])
      const service = serviceClient()
      const { data: existing, error: existingError } = await service
        .from('customers')
        .select('id, name, is_active, archived_at')
        .eq('id', customerId)
        .maybeSingle()
      if (existingError) throw existingError
      if (!existing || existing.archived_at) throw new HttpError(404, 'No encontramos ese cliente activo.')

      const archivedAt = new Date().toISOString()
      const { data: customer, error: archiveError } = await service
        .from('customers')
        .update({ is_active: false, archived_at: archivedAt })
        .eq('id', customerId)
        .is('archived_at', null)
        .select('id, name, archived_at')
        .maybeSingle()
      if (archiveError) throw archiveError
      if (!customer) throw new HttpError(409, 'El cliente ya fue eliminado.')

      const { error: suspendError } = await service
        .from('profiles')
        .update({ access_status: 'suspended' })
        .eq('customer_id', customerId)
        .eq('role', 'customer')
      if (suspendError) {
        await service.from('customers').update({ is_active: existing.is_active, archived_at: null }).eq('id', customerId)
        throw suspendError
      }

      return respond({ customer })
    }

    return respond({ error: 'Ruta no encontrada.' }, 404)
  } catch (error) {
    return errorResponse(error)
  }
})
