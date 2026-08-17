import assert from 'node:assert/strict'
import { scheduledDeliveryDate } from '../src/lib/orderSchedule.js'
import { isOrderForProduction } from '../src/lib/productionReportFilter.js'

assert.equal(scheduledDeliveryDate('2026-08-15T20:59:59.999Z'), '2026-08-16')
assert.equal(scheduledDeliveryDate('2026-08-15T21:00:00.000Z'), '2026-08-16')
assert.equal(scheduledDeliveryDate('2026-08-15T21:00:00.001Z'), '2026-08-17')
assert.equal(scheduledDeliveryDate('2026-08-16T21:00:00.000Z'), '2026-08-17')
assert.equal(scheduledDeliveryDate('2026-08-16T21:00:00.001Z'), '2026-08-18')

assert.equal(isOrderForProduction({ status: 'pending', created_at: '2026-08-15T21:00:00.001Z', delivery_date: '2026-08-17' }, '2026-08-17'), true)
assert.equal(isOrderForProduction({ status: 'pending', created_at: '2026-08-16T21:00:00.000Z', delivery_date: '2026-08-17' }, '2026-08-17'), true)
assert.equal(isOrderForProduction({ status: 'pending', created_at: '2026-08-16T21:00:00.001Z', delivery_date: '2026-08-18' }, '2026-08-17'), false)
assert.equal(isOrderForProduction({ status: 'cancelled', created_at: '2026-08-16T12:00:00.000Z', delivery_date: '2026-08-17' }, '2026-08-17'), false)
assert.equal(isOrderForProduction({ status: 'pending', created_at: '2026-08-01T12:00:00.000Z', delivery_date: '2026-08-16' }, '2026-08-17'), true)

console.log('Regla horaria verificada: 18:00 inclusive y pedidos posteriores al siguiente reparto.')
