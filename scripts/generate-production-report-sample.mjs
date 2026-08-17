import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProductionReportData, createProductionReportPdf } from '../src/lib/productionReport.js'

const deliveryDate = '2026-08-17'
const generatedAt = new Date('2026-08-16T21:05:00.000Z')
const products = {
  flauta: { id: 'flauta', name: 'Pan flauta', unit: 'unidad' },
  campo: { id: 'campo', name: 'Pan de campo', unit: 'kg' },
  croissant: { id: 'croissant', name: 'Croissants de manteca', unit: 'docena' },
  focaccia: { id: 'focaccia', name: 'Focaccia de romero', unit: 'unidad' },
}

const orders = [
  {
    id: 'order-1', customer_id: 'centro', order_number: 108, status: 'pending', delivery_date: deliveryDate, created_at: '2026-08-15T21:00:00.001Z',
    notes: 'Entregar antes de las 08:00.',
    customer: { id: 'centro', name: 'Panadería Centro', slug: 'centro', address_line_1: '18 de Julio 1240', city: 'Centro', phone: '2900 1122', delivery_notes: 'Entrada por calle Andes.' },
    items: [
      { product_id: 'flauta', product: products.flauta, quantity: 80 },
      { product_id: 'campo', product: products.campo, quantity: 14.5 },
      { product_id: 'croissant', product: products.croissant, quantity: 6 },
    ],
  },
  {
    id: 'order-2', customer_id: 'pocitos', order_number: 109, status: 'in_production', delivery_date: deliveryDate, created_at: '2026-08-16T15:00:00.000Z',
    notes: '',
    customer: { id: 'pocitos', name: 'Mercado Pocitos', slug: 'mercado-pocitos', address_line_1: 'Benito Blanco 724', city: 'Pocitos', phone: '2711 4580' },
    items: [
      { product_id: 'flauta', product: products.flauta, quantity: 120 },
      { product_id: 'campo', product: products.campo, quantity: 8.25 },
      { product_id: 'focaccia', product: products.focaccia, quantity: 24 },
    ],
  },
  {
    id: 'order-3', customer_id: 'centro', order_number: 110, status: 'pending', delivery_date: deliveryDate, created_at: '2026-08-16T21:00:00.000Z',
    notes: 'Sumar esta comanda al mismo reparto.',
    customer: { id: 'centro', name: 'Panadería Centro', slug: 'centro', address_line_1: '18 de Julio 1240', city: 'Centro', phone: '2900 1122', delivery_notes: 'Entrada por calle Andes.' },
    items: [
      { product_id: 'flauta', product: products.flauta, quantity: 20 },
      { product_id: 'focaccia', product: products.focaccia, quantity: 12 },
    ],
  },
  {
    id: 'order-overdue', customer_id: 'cordon', order_number: 111, status: 'pending', delivery_date: '2026-08-16', created_at: '2026-08-01T12:00:00.000Z',
    notes: 'Pendiente del cierre anterior.',
    customer: { id: 'cordon', name: 'Café Cordón', slug: 'cafe-cordon', address_line_1: 'Constituyente 1845', city: 'Cordón', phone: '2410 7788' },
    items: [
      { product_id: 'flauta', product: products.flauta, quantity: 5 },
      { product_id: 'croissant', product: products.croissant, quantity: 2 },
    ],
  },
  {
    id: 'order-cancelled', customer_id: 'cordon', order_number: 112, status: 'cancelled', delivery_date: deliveryDate, created_at: '2026-08-16T12:00:00.000Z',
    customer: { id: 'cordon', name: 'Cafe Cordon' },
    items: [{ product_id: 'flauta', product: products.flauta, quantity: 999 }],
  },
  {
    id: 'order-other-day', customer_id: 'centro', order_number: 107, status: 'pending', delivery_date: '2026-08-18', created_at: '2026-08-16T21:00:00.001Z',
    customer: { id: 'centro', name: 'Panadería Centro' },
    items: [{ product_id: 'campo', product: products.campo, quantity: 999 }],
  },
]

const report = buildProductionReportData(orders, deliveryDate)
assert.equal(report.orders.length, 4)
assert.equal(report.clients.length, 3)
assert.equal(report.productionItems.find((item) => item.id === 'flauta')?.quantity, 225)
assert.equal(report.productionItems.find((item) => item.id === 'campo')?.quantity, 22.75)
assert.equal(report.clients.find((client) => client.id === 'centro')?.items.find((item) => item.id === 'focaccia')?.quantity, 12)
assert.equal(report.clients.find((client) => client.id === 'cordon')?.items.find((item) => item.id === 'croissant')?.quantity, 2)

const { doc } = createProductionReportPdf({ orders, deliveryDate, generatedAt })
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = resolve(scriptDirectory, '..', 'output', 'pdf')
const outputPath = resolve(outputDirectory, 'reporte-produccion-ejemplo.pdf')
await mkdir(outputDirectory, { recursive: true })
await writeFile(outputPath, Buffer.from(doc.output('arraybuffer')))

console.log(`Reporte de muestra generado: ${outputPath}`)
