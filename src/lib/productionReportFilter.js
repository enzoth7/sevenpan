import { scheduledDeliveryDate } from './orderSchedule.js'

const dateKey = (value) => String(value || '').slice(0, 10)

export function isOrderForProduction(order, productionDate) {
  const status = String(order?.status || '').toLowerCase()
  const deliveryDate = dateKey(order?.delivery_date)
  const reportDate = dateKey(productionDate)
  const scheduledDate = order?.created_at ? scheduledDeliveryDate(order.created_at) : ''

  if (!reportDate || ['cancelled', 'delivered'].includes(status)) return false
  if (scheduledDate === reportDate || deliveryDate === reportDate) return true

  return status === 'pending' && deliveryDate && deliveryDate < reportDate
}
