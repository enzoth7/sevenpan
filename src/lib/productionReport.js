import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { isOrderForProduction } from './productionReportFilter.js'

const COLORS = {
  brown: [82, 52, 35],
  caramel: [187, 105, 55],
  cream: [249, 246, 239],
  ink: [42, 52, 60],
  muted: [102, 111, 117],
  border: [222, 216, 207],
  white: [255, 255, 255],
}

const PAGE = { width: 210, height: 297, margin: 15 }

const asNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const formatQuantity = (value) => new Intl.NumberFormat('es-UY', {
  maximumFractionDigits: 2,
}).format(asNumber(value))

const formatReportDate = (date) => new Intl.DateTimeFormat('es-UY', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Montevideo',
}).format(new Date(`${date}T12:00:00-03:00`))

const formatGeneratedAt = (date) => new Intl.DateTimeFormat('es-UY', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Montevideo',
}).format(date)

const customerName = (order) => order.customer?.name || 'Cliente sin nombre'

const productFromItem = (item) => ({
  id: item.product_id || item.product?.id || item.product?.name || 'producto-no-disponible',
  name: item.product?.name || 'Producto no disponible',
  unit: item.product?.unit || 'sin unidad',
})

const productKey = (item) => {
  const product = productFromItem(item)
  return `${product.id}::${product.unit}`
}

const addItemToMap = (map, item) => {
  const product = productFromItem(item)
  const key = productKey(item)
  const current = map.get(key) || { ...product, quantity: 0 }
  current.quantity += asNumber(item.quantity)
  map.set(key, current)
}

export function buildProductionReportData(orders, deliveryDate) {
  const includedOrders = (orders || [])
    .filter((order) => isOrderForProduction(order, deliveryDate))
    .sort((a, b) => customerName(a).localeCompare(customerName(b), 'es') || asNumber(a.order_number) - asNumber(b.order_number))

  const production = new Map()
  const clients = new Map()

  includedOrders.forEach((order) => {
    const clientId = order.customer_id || order.customer?.id || customerName(order)
    const existing = clients.get(clientId) || {
      id: clientId,
      name: customerName(order),
      items: new Map(),
    }

    ;(order.items || []).forEach((item) => {
      addItemToMap(production, item)
      addItemToMap(existing.items, item)
    })
    clients.set(clientId, existing)
  })

  const sortProducts = (items) => [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const clientGroups = [...clients.values()]
    .map((client) => ({ ...client, items: sortProducts(client.items) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return {
    deliveryDate,
    orders: includedOrders,
    productionItems: sortProducts(production),
    clients: clientGroups,
  }
}

function fill(doc, color) {
  doc.setFillColor(...color)
}

function text(doc, color) {
  doc.setTextColor(...color)
}

function drawMainHeader(doc, deliveryDate) {
  fill(doc, COLORS.brown)
  doc.rect(0, 0, PAGE.width, 31, 'F')
  fill(doc, COLORS.caramel)
  doc.rect(0, 31, PAGE.width, 2, 'F')

  text(doc, COLORS.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('SEVEN PAN', PAGE.margin, 13)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('FECHA DE ENTREGA', PAGE.width - PAGE.margin, 12, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(formatReportDate(deliveryDate), PAGE.width - PAGE.margin, 19, { align: 'right' })
}

function drawEmptyState(doc, y, message) {
  fill(doc, COLORS.cream)
  doc.roundedRect(PAGE.margin, y, PAGE.width - PAGE.margin * 2, 32, 3, 3, 'F')
  text(doc, COLORS.ink)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Sin pedidos para producir', PAGE.width / 2, y + 13, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  text(doc, COLORS.muted)
  doc.text(message, PAGE.width / 2, y + 21, { align: 'center' })
}

function tableTheme(extra = {}) {
  return {
    theme: 'grid',
    margin: { left: PAGE.margin, right: PAGE.margin, top: 18, bottom: 18 },
    styles: {
      font: 'helvetica', fontSize: 8.5, textColor: COLORS.ink,
      lineColor: COLORS.border, lineWidth: 0.15, cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
      valign: 'middle',
    },
    headStyles: {
      fillColor: COLORS.brown, textColor: COLORS.white, fontStyle: 'bold', fontSize: 8,
    },
    alternateRowStyles: { fillColor: COLORS.cream },
    ...extra,
  }
}

function addClientBlock(doc, client, initialY) {
  const estimatedHeight = 17 + Math.min(client.items.length, 6) * 10
  let y = initialY
  if (y + estimatedHeight > PAGE.height - 22) {
    doc.addPage()
    y = 21
  }

  text(doc, COLORS.ink)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(client.name, PAGE.margin, y + 5)

  autoTable(doc, tableTheme({
    startY: y + 9,
    head: [['Producto', 'Unidad', 'Cantidad']],
    body: client.items.map((item) => [item.name, item.unit, formatQuantity(item.quantity)]),
    columnStyles: {
      0: { cellWidth: 112 },
      1: { cellWidth: 30 },
      2: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
    },
    rowPageBreak: 'avoid',
  }))

  return doc.lastAutoTable.finalY + 8
}

function finishDocument(doc, deliveryDate, generatedAt, mainHeaderPages) {
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    if (!mainHeaderPages.has(page)) {
      fill(doc, COLORS.brown)
      doc.rect(0, 0, PAGE.width, 12, 'F')
      text(doc, COLORS.white)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('SEVEN PAN', PAGE.margin, 7.7)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.text('FECHA DE ENTREGA', PAGE.width - PAGE.margin, 5.4, { align: 'right' })
      doc.setFontSize(7.5)
      doc.text(formatReportDate(deliveryDate), PAGE.width - PAGE.margin, 7.7, { align: 'right' })
    }

    doc.setDrawColor(...COLORS.border)
    doc.line(PAGE.margin, PAGE.height - 12, PAGE.width - PAGE.margin, PAGE.height - 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    text(doc, COLORS.muted)
    doc.text(`Generado ${formatGeneratedAt(generatedAt)}`, PAGE.margin, PAGE.height - 7)
    doc.text(`Página ${page} de ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 7, { align: 'right' })
  }
}

export function createProductionReportPdf({ orders, deliveryDate, generatedAt = new Date() }) {
  const report = buildProductionReportData(orders, deliveryDate)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const mainHeaderPages = new Set([1])

  doc.setProperties({
    title: `Producción Seven Pan - ${deliveryDate}`,
    subject: 'Totales por producto y detalle por cliente',
    author: 'Seven Pan Panaderias',
  })

  drawMainHeader(doc, deliveryDate)

  text(doc, COLORS.ink)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Totales a producir por producto', PAGE.margin, 48)

  if (report.productionItems.length) {
    autoTable(doc, tableTheme({
      startY: 58,
      head: [['Producto', 'Unidad', 'Cantidad total']],
      body: report.productionItems.map((item) => [item.name, item.unit, formatQuantity(item.quantity)]),
      columnStyles: {
        0: { cellWidth: 112 },
        1: { cellWidth: 30 },
        2: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
      },
      rowPageBreak: 'avoid',
    }))
  } else {
    drawEmptyState(doc, 60, 'No hay comandas activas con entrega para esta fecha.')
  }

  doc.addPage()
  mainHeaderPages.add(doc.getNumberOfPages())
  drawMainHeader(doc, deliveryDate)
  text(doc, COLORS.ink)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Pedidos separados por clientes', PAGE.margin, 48)

  if (report.clients.length) {
    let y = 60
    report.clients.forEach((client) => { y = addClientBlock(doc, client, y) })
  } else {
    drawEmptyState(doc, 60, 'El detalle por cliente aparecera cuando ingresen pedidos.')
  }

  finishDocument(doc, deliveryDate, generatedAt, mainHeaderPages)
  return { doc, report }
}

export function downloadProductionReportPdf(options) {
  const { doc, report } = createProductionReportPdf(options)
  const filename = `produccion-${report.deliveryDate}.pdf`
  doc.save(filename)
  return { filename, report }
}
