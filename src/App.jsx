import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Bell, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Copy,
  LayoutDashboard, LogOut, MailPlus, MapPin, Menu, Package, Pencil, Plus, Save, Search,
  ShoppingBag, Store, TrendingUp, Truck, UserRound, X,
} from 'lucide-react'
import {
  apiRequest, getMyProfile, loadWorkspace, signIn, signOut, subscribeToCatalog, supabase,
} from './supabase'
import { BRAND, COPY } from './lib/copy.es'

const formatMoney = (value) => new Intl.NumberFormat('es-UY', {
  style: 'currency', currency: 'UYU', maximumFractionDigits: 0,
}).format(Number(value || 0))

const formatQuantity = (value) => new Intl.NumberFormat('es-UY', {
  maximumFractionDigits: 2,
}).format(Number(value || 0))

const formatDate = (date) => new Intl.DateTimeFormat('es-UY', {
  weekday: 'short', day: 'numeric', month: 'short',
}).format(new Date(`${date}T12:00:00`))

const formatOrderCreated = (date) => new Intl.DateTimeFormat('es-UY', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'America/Montevideo',
}).format(new Date(date))

const uruguayDate = (daysFromToday = 0) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + daysFromToday))
  return date.toISOString().slice(0, 10)
}

const tomorrow = () => uruguayDate(1)

const montevideoDateKey = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))

function ordersForPeriod(orders, period) {
  const today = montevideoDateKey()
  if (period === 'Hoy') return orders.filter((order) => montevideoDateKey(order.created_at) === today)
  if (period === 'Mes') return orders.filter((order) => montevideoDateKey(order.created_at).slice(0, 7) === today.slice(0, 7))
  const current = new Date(`${today}T12:00:00Z`)
  const weekday = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() - weekday + 1)
  const weekStart = current.toISOString().slice(0, 10)
  return orders.filter((order) => {
    const key = montevideoDateKey(order.created_at)
    return key >= weekStart && key <= today
  })
}

function productSales(orders, metric) {
  const totals = new Map()
  orders.forEach((order) => order.items.forEach((item) => {
    if (!item.product) return
    const previous = totals.get(item.product.id) || { ...item.product, quantity: 0, revenue: 0, kilograms: 0 }
    previous.quantity += item.quantity
    previous.revenue += item.quantity * item.unit_price
    if (item.product.unit === 'kg') previous.kilograms += item.quantity
    totals.set(item.product.id, previous)
  }))
  return [...totals.values()]
    .filter((product) => metric !== 'kilograms' || product.kilograms > 0)
    .sort((a, b) => b[metric] - a[metric])
}

const orderNumber = (order) => `#${String(order.order_number).padStart(4, '0')}`
const orderItemsText = (order) => order.items.map((item) => item.product?.name || COPY.productUnavailable).join(', ')
const customerCode = (customer) => String(customer.slug || customer.initials || customer.id?.slice(0, 8) || 'cliente').toUpperCase()
const customerRoutes = {
  home: '/inicio',
  catalog: '/hacer-pedido',
  orders: '/pedidos',
  stats: '/estadisticas',
  profile: '/mi-panaderia',
}
const adminRoutes = {
  summary: '/admin',
  orders: '/admin/pedidos',
  customers: '/admin/clientes',
  products: '/admin/productos',
}
const customerViewFromPath = (pathname = window.location.pathname) => Object.entries(customerRoutes).find(([, path]) => path === pathname)?.[0] || 'home'
const adminLocationFromPath = (pathname = window.location.pathname) => {
  const customerMatch = pathname.match(/^\/admin\/clientes\/([^/]+)\/?$/)
  if (customerMatch) return { tab: 'customers', customerSlug: decodeURIComponent(customerMatch[1]) }
  const tab = Object.entries(adminRoutes).find(([, path]) => path === pathname.replace(/\/$/, '') || path === pathname)?.[0]
  return { tab: tab || 'summary', customerSlug: '' }
}
const updateBrowserPath = (path, replace = false) => {
  if (window.location.pathname === path) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
}
const statusLabel = COPY.status
const statusClass = {
  pending: 'pending', in_production: 'making', dispatched: 'shipping',
  delivered: 'delivered', cancelled: 'pending',
}
const nextStatus = {
  pending: 'in_production', in_production: 'dispatched', dispatched: 'delivered',
}

function Brand({ dark = false }) {
  return <div className={`brand ${dark ? 'brand-dark' : ''}`}><img className="brand-logo" src="/LogoTransparente.png" alt={BRAND.fullName}/></div>
}

function Status({ status }) {
  return <span className={`status ${statusClass[status]}`}>
    {status === 'delivered' && <Check size={13}/>} {statusLabel[status]}
  </span>
}

function Toast({ message }) {
  return message ? <div className="toast"><Check size={18}/>{message}</div> : null
}

function Loading({ message, error, retry }) {
  return <main className="login-shell">
    <section className="login-copy"><Brand dark /><div className="login-hero"><span className="eyebrow">{BRAND.fullName.toUpperCase()}</span><h1>{error ? 'No pudimos cargar tu cuenta.' : 'Preparando tu operación.'}</h1><p>{error || message}</p>{retry && <button className="primary-button" onClick={retry}>Reintentar <ArrowRight size={18}/></button>}</div></section>
    <section className="login-form-wrap"><div className="loading-panel"><Package size={28}/><p>{error ? 'Revisá tu conexión o los permisos asignados a tu usuario.' : 'Conectando con el catálogo y las comandas.'}</p></div></section>
  </main>
}

function Login({ onSignIn, submitting, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event) => {
    event.preventDefault()
    onSignIn(email.trim(), password)
  }

  return <main className="login-shell">
    <section className="login-copy">
      <Brand dark />
      <div className="login-hero">
        <span className="eyebrow">PAN ARTESANAL, TODOS LOS DÍAS</span>
        <h1>La alegría<br /><em>es pan comido.</em></h1>
        <p>Gestioná tus pedidos mayoristas con el sabor natural y la calidad artesanal de Seven Pan.</p>
      </div>
      <p className="copyright">© 2026 {BRAND.fullName} · Calidad artesanal</p>
    </section>
    <section className="login-form-wrap">
      <form className="login-form" onSubmit={submit}>
        <div className="mobile-brand"><Brand /></div>
        <h2>Ingresá a tu cuenta</h2>
        <p className="form-intro">Usá el correo y contraseña enviados por Seven Pan.</p>
        <label>Correo electrónico<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@panaderia.com" /></label>
        <label>Contraseña<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" /></label>
        {error && <p className="form-error">{error}</p>}
        <button disabled={submitting} className="primary-button login-button" type="submit"><span>{submitting ? 'Ingresando…' : 'Ingresar'}</span><ArrowRight size={19} /></button>
        <p className="support">¿Necesitás ayuda? Encontranos en {BRAND.address}.</p>
      </form>
    </section>
  </main>
}

function Sidebar({ view, setView, profile, customer, onLogout }) {
  const menu = [
    { id: 'home', icon: LayoutDashboard, label: 'Inicio' },
    { id: 'catalog', icon: ShoppingBag, label: 'Hacer pedido' },
    { id: 'orders', icon: Package, label: 'Mis pedidos' },
    { id: 'stats', icon: TrendingUp, label: 'Estadísticas' },
    { id: 'profile', icon: UserRound, label: 'Mi panadería' },
  ]
  return <aside className="sidebar">
    <Brand dark />
    <nav>{menu.map(({ id, icon: Icon, label }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span>{id === 'catalog' && <i className="side-dot" />}</button>)}</nav>
    <div className="sidebar-bottom"><div className="business-card"><div className="business-avatar">{customer?.initials || 'SP'}</div><div><strong>{customer?.name || profile?.full_name || 'Panadería'}</strong><span>Panadería asociada</span></div></div><button className="logout" onClick={onLogout}><LogOut size={18}/> Cerrar sesión</button></div>
  </aside>
}

function Topbar({ title, subtitle, cartQuantity, onOpenCart }) {
  return <header className="topbar"><div><div className="mobile-menu"><Menu size={21}/></div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="topbar-actions"><button className="notification" aria-label="Notificaciones"><Bell size={20}/><i/></button>{onOpenCart && <button className="cart-button" onClick={onOpenCart}><ShoppingBag size={18}/><span>Comanda</span>{cartQuantity > 0 && <b>{cartQuantity}</b>}</button>}</div></header>
}

function OrderSummary({ quantities, products, onOpenCatalog }) {
  const items = products.filter((product) => quantities[product.id]).slice(0, 3)
  const total = products.reduce((sum, product) => sum + (quantities[product.id] || 0) * Number(product.price), 0)
  const count = Object.values(quantities).reduce((sum, value) => sum + value, 0)
  return <section className="order-summary-card"><div className="order-summary-head"><div><span className="section-label">NUEVA COMANDA</span><h3>{count ? 'Tu comanda está lista para confirmar' : 'Armá la comanda de mañana'}</h3></div><span className="delivery-badge"><Truck size={15}/> Entrega programada</span></div>{count ? <><div className="summary-lines">{items.map((item) => <div key={item.id}><span>{quantities[item.id]} {item.unit} <b>{item.name}</b></span><strong>{formatMoney(quantities[item.id] * Number(item.price))}</strong></div>)}</div><div className="summary-footer"><div><small>TOTAL ESTIMADO</small><strong>{formatMoney(total)}</strong></div><button className="dark-button" onClick={onOpenCatalog}>Ver comanda <ArrowRight size={17}/></button></div></> : <div className="empty-order"><Package size={24}/><p>Elegí productos del catálogo para preparar la próxima entrega.</p><button className="text-action" onClick={onOpenCatalog}>Ir al catálogo <ArrowRight size={15}/></button></div>}</section>
}

function BakeryHome({ quantities, products, orders, setView, onRepeat }) {
  const lastOrders = orders.slice(0, 2)
  const cartQuantity = Object.values(quantities).reduce((sum, value) => sum + value, 0)
  return <><Topbar title="Buenos días" subtitle="Tu operación conectada a Seven Pan" cartQuantity={cartQuantity} onOpenCart={() => setView('catalog')} /><main className="page-content home-content"><section className="welcome-row"><div><span className="eyebrow warm">TODO LISTO PARA MAÑANA</span><h2>{BRAND.naturalClaim}</h2></div><button className="secondary-button" onClick={() => onRepeat(orders[0])} disabled={!orders[0]}><Copy size={17}/> Repetir último pedido</button></section><OrderSummary quantities={quantities} products={products} onOpenCatalog={() => setView('catalog')} /><section className="history-section home-history-section"><div className="section-heading"><div><span className="section-label">ÚLTIMAS COMANDAS</span><h3>Historial de pedidos</h3></div><button className="link-button" onClick={() => setView('orders')}>Ver todos <ArrowRight size={15}/></button></div><div className="history-table">{lastOrders.map((order) => <div className="history-row" key={order.id}><div className="date-square"><span>{formatDate(order.delivery_date).split(' ')[0]}</span><b>{new Date(`${order.delivery_date}T12:00:00`).getDate()}</b></div><div className="history-details"><strong>Pedido {orderNumber(order)}</strong><span>{orderItemsText(order)}</span></div><strong className="history-price">{formatMoney(order.total)}</strong><Status status={order.status}/><button className="round-action" onClick={() => onRepeat(order)}><Copy size={16}/></button></div>)}{!lastOrders.length && <div className="empty-order"><p>Todavía no tenés comandas registradas.</p></div>}</div></section></main><MobileNav view={setView}/></>
}

function MobileNav({ view }) {
  return <div className="mobile-nav"><button className="active" onClick={() => view('home')}><LayoutDashboard size={19}/>Inicio</button><button onClick={() => view('catalog')}><ShoppingBag size={19}/>Pedido</button><button onClick={() => view('orders')}><Package size={19}/>Pedidos</button><button onClick={() => view('profile')}><UserRound size={19}/>Perfil</button></div>
}

function Catalog({ quantities, products, updateQuantity, onSubmit, submitting, editingOrder, onCancelEdit }) {
  const [category, setCategory] = useState('Todos')
  const [search, setSearch] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(editingOrder?.delivery_date || tomorrow())
  const [notes, setNotes] = useState(editingOrder?.notes || '')
  useEffect(() => { setDeliveryDate(editingOrder?.delivery_date || tomorrow()); setNotes(editingOrder?.notes || '') }, [editingOrder])
  const filtered = products.filter((product) => (category === 'Todos' || product.category === category) && product.name.toLowerCase().includes(search.toLowerCase()))
  const units = Object.values(quantities).reduce((sum, value) => sum + value, 0)
  const total = products.reduce((sum, product) => sum + (quantities[product.id] || 0) * Number(product.price), 0)
  return <><Topbar title={editingOrder ? 'Editar comanda' : 'Hacer pedido'} subtitle="Entrega programada según tu fecha elegida" cartQuantity={units} onOpenCart={() => document.querySelector('.order-panel')?.scrollIntoView({ behavior: 'smooth' })}/><main className="page-content catalog-layout"><div className="catalog-main"><div className="catalog-tools"><div className="filters">{['Todos', 'Panificados', 'Pastelería', 'Especialidades'].map((item) => <button onClick={() => setCategory(item)} className={category === item ? 'active' : ''} key={item}>{item}</button>)}</div><label className="search-box"><Search size={18}/><input placeholder="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><div className="product-list">{filtered.map((product) => <article className="product-card" key={product.id}><div className={`product-art ${product.tone}`}><div className={`product-shape ${product.id}`}><i/><i/><i/></div></div><div className="product-info"><span>{product.category}</span><h3>{product.name}</h3><p>{product.detail}</p><strong>{formatMoney(product.price)} <small>/ {product.unit}</small></strong></div><div className="quantity-control"><button onClick={() => updateQuantity(product.id, -1)} disabled={!quantities[product.id]}>−</button><b>{quantities[product.id] || 0}</b><button onClick={() => updateQuantity(product.id, 1)}>+</button><span>{product.unit}</span></div></article>)}</div></div><aside className="order-panel"><div className="order-panel-head"><div><span className="section-label">TU COMANDA</span><h2>{editingOrder ? `Pedido ${orderNumber(editingOrder)}` : 'Pedido nuevo'}</h2></div><span>{Object.keys(quantities).filter((key) => quantities[key]).length} productos</span></div><div className="order-fields"><label>Fecha de entrega<input type="date" min={tomorrow()} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label><label>Notas para entrega<textarea value={notes} maxLength="500" placeholder="Opcional" onChange={(event) => setNotes(event.target.value)} /></label></div><div className="order-panel-items">{products.filter((product) => quantities[product.id]).map((product) => <div key={product.id}><span>{quantities[product.id]} {product.unit} · {product.name}</span><strong>{formatMoney(quantities[product.id] * Number(product.price))}</strong></div>)}{!units && <div className="panel-empty"><ShoppingBag size={24}/><p>Tu comanda está vacía.<br/>Sumá productos del catálogo.</p></div>}</div><div className="order-total"><span>Total estimado</span><strong>{formatMoney(total)}</strong><small>El precio final se valida al confirmar.</small></div><button disabled={!units || submitting} className="primary-button confirm-order" onClick={() => onSubmit({ deliveryDate, notes })}>{submitting ? 'Guardando…' : editingOrder ? 'Guardar cambios' : 'Confirmar comanda'} <ArrowRight size={18}/></button>{editingOrder && <button className="order-cancel-edit" onClick={onCancelEdit}><X size={15}/> Cancelar edición</button>}<p className="order-note"><Clock3 size={15}/> Podés modificar una comanda pendiente hasta las 18:00 hs.</p></aside></main></>
}

function BakeryOrderCard({ order, onRepeat, onEdit, onCancel, cancelling }) {
  const [open, setOpen] = useState(false)
  return <article className={`order-card bakery-order-card ${open ? 'open' : ''}`}><div className="bakery-order-summary"><div className="order-card-main"><div className="order-number"><Package size={20}/></div><div><div className="order-title"><h3>Pedido {orderNumber(order)}</h3><Status status={order.status}/></div><p>{formatDate(order.delivery_date)} · {orderItemsText(order)}</p></div></div><div className="order-card-total"><small>TOTAL</small><strong>{formatMoney(order.total)}</strong></div>{order.status === 'pending' && <div className="order-actions"><button className="secondary-button compact" onClick={() => onEdit(order)}><Pencil size={15}/> Editar</button><button className="icon-text-button danger" disabled={cancelling} onClick={() => onCancel(order)}><X size={15}/> Cancelar</button></div>}<button className="secondary-button compact bakery-repeat-button" onClick={() => onRepeat(order)}><Copy size={16}/> Repetir</button><button type="button" className="bakery-order-detail-toggle" aria-expanded={open} aria-controls={`bakery-order-${order.id}`} onClick={() => setOpen((value) => !value)}><span>{open ? 'Ocultar' : 'Ver detalle'}</span><ChevronDown size={17}/></button></div>{open && <div className="bakery-order-detail" id={`bakery-order-${order.id}`}><OrderDetail order={order} showHeader={false}/></div>}</article>
}

function Orders({ orders, onRepeat, onEdit, onCancel, cancellingId }) {
  return <><Topbar title="Mis pedidos" subtitle="Consultá, repetí o ajustá tus comandas pendientes"/><main className="page-content orders-page"><section className="orders-heading"><div><span className="eyebrow warm">HISTORIAL</span><h2>Tus últimas comandas</h2></div><button className="secondary-button" onClick={() => onRepeat(orders[0])} disabled={!orders[0]}><Copy size={17}/> Repetir último pedido</button></section><div className="order-list">{orders.map((order) => <BakeryOrderCard order={order} onRepeat={onRepeat} onEdit={onEdit} onCancel={onCancel} cancelling={cancellingId === order.id} key={order.id}/>)}{!orders.length && <p className="empty-copy">Todavía no hay pedidos para mostrar.</p>}</div></main></>
}

function productTotals(orders) {
  const totals = new Map()
  orders.forEach((order) => order.items.forEach((item) => {
    if (!item.product) return
    const previous = totals.get(item.product.id) || { ...item.product, quantity: 0 }
    previous.quantity += item.quantity
    totals.set(item.product.id, previous)
  }))
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity)
}

const customerStatsPeriods = {
  week: { label: 'Últimos 7 días', days: 7 },
  month: { label: 'Último mes', days: 30 },
  all: { label: 'Historial completo' },
}

function customerOrdersForPeriod(orders, period) {
  const completedOrders = orders.filter((order) => order.status !== 'cancelled')
  const days = customerStatsPeriods[period]?.days
  if (!days) return completedOrders
  const today = montevideoDateKey()
  const periodStart = uruguayDate(-(days - 1))
  return completedOrders.filter((order) => {
    const createdDate = montevideoDateKey(order.created_at)
    return createdDate >= periodStart && createdDate <= today
  })
}

function Stats({ orders }) {
  const [period, setPeriod] = useState('all')
  const [chartMetric, setChartMetric] = useState('quantity')
  const periodOrders = useMemo(() => customerOrdersForPeriod(orders, period), [orders, period])
  const total = periodOrders.reduce((sum, order) => sum + order.total, 0)
  const productsByQuantity = productSales(periodOrders, 'quantity')
  const productsByRevenue = productSales(periodOrders, 'revenue')
  const topQuantity = productsByQuantity[0]
  const topRevenue = productsByRevenue[0]
  const chartProducts = (chartMetric === 'quantity' ? productsByQuantity : productsByRevenue).slice(0, 6)
  const chartMaximum = Math.max(...chartProducts.map((product) => product[chartMetric]), 1)
  const favoriteValue = topQuantity ? `${formatQuantity(topQuantity.quantity)} ${topQuantity.unit}` : '—'
  const favoriteLabel = topQuantity ? `${topQuantity.name} · más comprado` : 'Producto más comprado'

  const chartValue = (product) => chartMetric === 'revenue'
    ? formatMoney(product.revenue)
    : `${formatQuantity(product.quantity)} ${product.unit}`

  return <><Topbar title="Estadísticas" subtitle="Datos reales de tus compras"/><main className="page-content stats-page customer-stats"><div className="stats-heading"><div><span className="eyebrow warm">TU ACTIVIDAD</span><h2>Una mirada a tus compras</h2></div><label className="date-select stats-period-select"><CalendarDays size={17}/><select aria-label="Período de estadísticas" value={period} onChange={(event) => setPeriod(event.target.value)}>{Object.entries(customerStatsPeriods).map(([value, option]) => <option value={value} key={value}>{option.label}</option>)}</select><ChevronDown size={15}/></label></div><section className="kpi-row"><Metric label="Total gastado" value={formatMoney(total)}/><Metric label="Comandas" value={periodOrders.length}/><Metric label={favoriteLabel} value={favoriteValue}/></section><section className="stats-charts"><article className="chart-card customer-product-chart"><div className="customer-chart-heading"><div><span className="section-label">POR PRODUCTO</span><h3>{chartMetric === 'quantity' ? 'Lo que más comprás' : 'En lo que más gastás'}</h3></div><div className="stats-chart-tabs" role="group" aria-label="Métrica del gráfico"><button type="button" className={chartMetric === 'quantity' ? 'active' : ''} onClick={() => setChartMetric('quantity')}>Cantidad</button><button type="button" className={chartMetric === 'revenue' ? 'active' : ''} onClick={() => setChartMetric('revenue')}>Gasto</button></div></div>{chartProducts.length ? <div className="bar-chart product-bar-chart">{chartProducts.map((product) => <div className="bar-column" key={`${product.id}-${chartMetric}`} title={`${product.name}: ${chartValue(product)}`}><strong>{chartValue(product)}</strong><i className="today" style={{ height: `${Math.max(10, Math.round(product[chartMetric] / chartMaximum * 74))}%` }}/><span>{product.name}</span></div>)}</div> : <div className="stats-empty"><Package size={24}/><p>No hay compras registradas en este período.</p></div>}</article><article className="top-products customer-product-summary"><div><span className="section-label">DESTACADOS</span><h3>Tus productos</h3></div><div className="product-winner"><span>MÁS COMPRADO</span><strong>{topQuantity?.name || 'Sin datos'}</strong><b>{topQuantity ? `${formatQuantity(topQuantity.quantity)} ${topQuantity.unit}` : '—'}</b></div><div className="product-winner"><span>MAYOR GASTO</span><strong>{topRevenue?.name || 'Sin datos'}</strong><b>{topRevenue ? formatMoney(topRevenue.revenue) : '—'}</b></div></article></section></main></>
}

function Metric({ label, value }) {
  return <article className="metric-card"><h3>{value}</h3><span>{label}</span></article>
}

function CustomerProfile({ customer, onSave, saving }) {
  const [form, setForm] = useState({ addressLine1: '', city: '', phone: '', deliveryNotes: '' })
  useEffect(() => { if (customer) setForm({ addressLine1: customer.address_line_1 || '', city: customer.city || customer.location || '', phone: customer.phone || '', deliveryNotes: customer.delivery_notes || '' }) }, [customer])
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  return <><Topbar title="Mi panadería" subtitle="Mantené actualizada la información para las entregas"/><main className="page-content profile-page"><section className="profile-card"><div className="profile-card-heading"><div className="icon-circle"><Store size={21}/></div><div><span className="eyebrow warm">DATOS DE ENTREGA</span><h2>{customer?.name || 'Tu panadería'}</h2><p>Estos datos los usa Seven Pan para planificar tu ruta.</p></div></div><div className="profile-form"><label>Dirección<input value={form.addressLine1} onChange={change('addressLine1')} placeholder="Calle, número y local" /></label><label>Ciudad o barrio<input value={form.city} onChange={change('city')} placeholder="Ej. Pocitos" /></label><label>Teléfono de contacto<input value={form.phone} onChange={change('phone')} placeholder="099 000 000" /></label><label className="full-field">Indicaciones para la entrega<textarea value={form.deliveryNotes} onChange={change('deliveryNotes')} placeholder="Horario, puerta, referencia u observaciones" /></label></div><button disabled={saving} className="primary-button" onClick={() => onSave(form)}><Save size={17}/>{saving ? 'Guardando…' : 'Guardar datos'}</button></section></main></>
}

function AdminMetric({ label, value, tone }) {
  return <article className={`admin-metric ${tone}`}><h3 className="metric-value">{value}</h3><span>{label}</span></article>
}

function ProductManager({ products, onSave, onCreate, savingId, creating }) {
  const [drafts, setDrafts] = useState({})
  const [invalidPrice, setInvalidPrice] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', detail: '', price: '', unit: 'kg', category: 'Panificados' })
  useEffect(() => setDrafts(Object.fromEntries(products.map((product) => [product.id, String(product.price)]))), [products])
  const savePrice = (product) => {
    const value = (drafts[product.id] ?? '').trim()
    const price = Number(value)
    if (!value || !Number.isFinite(price) || price < 0) return setInvalidPrice(product.id)
    setInvalidPrice(null)
    onSave(product, { price })
  }
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const create = async (event) => {
    event.preventDefault()
    const price = Number(form.price)
    if (!Number.isFinite(price) || price < 0) return
    const created = await onCreate({ ...form, price })
    if (!created) return
    setForm({ name: '', detail: '', price: '', unit: 'kg', category: 'Panificados' })
    setAdding(false)
  }
  return <section className="admin-product-section" id="productos">
    <div className="product-page-toolbar"><span className="admin-hint">Los cambios se reflejan en todas las panaderías.</span><button className="secondary-button" onClick={() => setAdding((value) => !value)}><Plus size={16}/>{adding ? 'Cerrar' : 'Agregar producto'}</button></div>
    {adding && <form className="new-product-form" onSubmit={create}><label>Producto<input required minLength="2" maxLength="120" value={form.name} onChange={change('name')} placeholder="Ej. Pan de masa madre" /></label><label>Categoría<select value={form.category} onChange={change('category')}><option>Panificados</option><option>Pastelería</option><option>Especialidades</option></select></label><label>Unidad<select value={form.unit} onChange={change('unit')}><option value="kg">kg</option><option value="unidad">unidad</option><option value="docena">docena</option></select></label><label>Precio<input required type="number" min="0" step="0.01" value={form.price} onChange={change('price')} /></label><label className="product-detail-field">Descripción<input required minLength="2" maxLength="240" value={form.detail} onChange={change('detail')} placeholder="Descripción breve para el catálogo" /></label><button disabled={creating} className="primary-button" type="submit"><Plus size={17}/>{creating ? 'Agregando…' : 'Agregar al catálogo'}</button></form>}
    <div className="product-admin-table"><div className="product-admin-head"><span>PRODUCTO</span><span>UNIDAD</span><span>PRECIO GLOBAL</span><span>EN CATÁLOGO</span><span></span></div>{products.map((product) => <div className={`product-admin-row ${product.is_active ? '' : 'removed'}`} key={product.id}><div><strong>{product.name}</strong><span>{product.category}</span></div><span>{product.unit}</span><label className="price-editor"><span>$</span><input type="number" min="0" step="0.01" value={drafts[product.id] ?? ''} onChange={(event) => { setInvalidPrice(null); setDrafts((current) => ({ ...current, [product.id]: event.target.value })) }} />{invalidPrice === product.id && <small>Ingresá un precio válido.</small>}</label><button className={`availability-toggle ${product.is_active ? 'enabled' : ''}`} disabled={savingId === product.id} onClick={() => onSave(product, { isActive: !product.is_active })}>{product.is_active ? 'Visible' : 'Quitado'}</button><button className="round-action" disabled={savingId === product.id} onClick={() => savePrice(product)} aria-label={`Guardar precio de ${product.name}`}><Save size={16}/></button></div>)}</div>
  </section>
}

function InviteCustomer({ onInvite, saving }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', contactName: '', name: '', slug: '', addressLine1: '', city: '', phone: '', deliveryNotes: '' })
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const submit = async (event) => { event.preventDefault(); await onInvite(form); setForm({ email: '', contactName: '', name: '', slug: '', addressLine1: '', city: '', phone: '', deliveryNotes: '' }); setOpen(false) }
  return <section className="invite-section" id="clientes"><div className="section-heading"><div><span className="section-label">NUEVA CUENTA</span><h2>Invitar una panadería</h2></div><button className="secondary-button" onClick={() => setOpen((value) => !value)}><MailPlus size={16}/>{open ? 'Cerrar' : 'Enviar invitación'}</button></div>{open && <form className="invite-form" onSubmit={submit}><label>Nombre de la panadería<input required value={form.name} onChange={change('name')} /></label><label>Identificador<input required pattern="[a-z0-9-]+" value={form.slug} onChange={change('slug')} placeholder="panaderia-centro" /></label><label>Contacto<input required value={form.contactName} onChange={change('contactName')} /></label><label>Email<input required type="email" value={form.email} onChange={change('email')} /></label><label>Dirección<input required value={form.addressLine1} onChange={change('addressLine1')} /></label><label>Ciudad o barrio<input required value={form.city} onChange={change('city')} /></label><label>Teléfono<input required value={form.phone} onChange={change('phone')} /></label><label>Indicaciones<textarea value={form.deliveryNotes} onChange={change('deliveryNotes')} /></label><button disabled={saving} className="primary-button" type="submit"><MailPlus size={17}/>{saving ? 'Enviando…' : 'Crear e invitar'}</button></form>}</section>
}

function AdminDashboard({ orders, customers, products, onStatusChange, onProductSave, onInvite, savingOrderId, savingProductId, inviting, onLogout }) {
  const [period, setPeriod] = useState('Hoy')
  const days = period === 'Hoy' ? 1 : period === 'Semana' ? 7 : 31
  const periodOrders = useMemo(() => orders.filter((order) => Date.now() - new Date(order.created_at).getTime() <= days * 86400000), [days, orders])
  const activeOrders = orders.filter((order) => !['delivered', 'cancelled'].includes(order.status))
  const production = productTotals(activeOrders).slice(0, 4)
  const revenue = periodOrders.reduce((sum, order) => sum + order.total, 0)
  const totalKg = activeOrders.reduce((sum, order) => sum + order.totalKg, 0)
  return <div className="admin-shell"><header className="admin-header"><Brand/><div className="admin-nav"><button className="active">Resumen</button><button onClick={() => document.querySelector('#pedidos')?.scrollIntoView({ behavior: 'smooth' })}>Pedidos</button><button onClick={() => document.querySelector('#clientes')?.scrollIntoView({ behavior: 'smooth' })}>Clientes</button><button onClick={() => document.querySelector('#productos')?.scrollIntoView({ behavior: 'smooth' })}>Productos</button></div><div className="admin-actions"><button className="notification" aria-label="Notificaciones"><Bell size={19}/><i/></button><div className="admin-profile"><div>SP</div><span>Admin sevenpan</span><ChevronDown size={15}/></div><button onClick={onLogout} className="admin-exit" title="Cerrar sesión"><LogOut size={18}/></button></div></header><main className="admin-content"><div className="admin-title"><div><span className="eyebrow warm">PANEL DE CONTROL</span><h1>Buenos días, administración <span>👋</span></h1><p>Indicadores calculados desde las comandas guardadas.</p></div><div className="period-tabs">{['Hoy', 'Semana', 'Mes'].map((item) => <button key={item} onClick={() => setPeriod(item)} className={period === item ? 'active' : ''}>{item}</button>)}</div></div><section className="admin-kpis"><AdminMetric label="Facturación registrada" value={formatMoney(revenue)} diff={period.toLowerCase()} tone="orange"/><AdminMetric label="Pedidos recibidos" value={periodOrders.length} diff={`${activeOrders.length} en curso`} tone="blue"/><AdminMetric label="Kg a producir" value={`${totalKg.toFixed(0)} kg`} diff="Pedidos no entregados" tone="green"/><AdminMetric label="Clientes activos" value={customers.filter((customer) => customer.is_active).length} diff="Panaderías habilitadas" tone="pink"/></section><section className="admin-grid"><article className="admin-chart-card"><div className="chart-heading"><div><span className="section-label">PEDIDOS</span><h2>Órdenes por estado</h2></div></div><div className="bar-chart">{['pending', 'in_production', 'dispatched', 'delivered'].map((status) => { const count = orders.filter((order) => order.status === status).length; return <div className="bar-column" key={status}><i className="today" style={{ height: `${Math.max(8, count / Math.max(orders.length, 1) * 100)}%` }}/><span>{statusLabel[status]}</span></div> })}</div></article><article className="production-card"><div className="chart-heading"><div><span className="section-label">PARA PRODUCIR</span><h2>Top productos</h2></div></div>{production.map((product, index) => <div className="production-item" key={product.id}><span className={`prod-color c${index}`}/><div><strong>{product.name}</strong><span>{product.quantity} {product.unit}</span></div><b>{Math.round(product.quantity / production[0].quantity * 100)}%</b></div>)}</article></section><ProductManager products={products} onSave={onProductSave} savingId={savingProductId}/><InviteCustomer onInvite={onInvite} saving={inviting}/><section className="customer-section" id="pedidos"><div className="section-heading"><div><span className="section-label">ACTIVIDAD RECIENTE</span><h2>Pedidos de clientes</h2></div></div><div className="customers-table"><div className="customers-head"><span>CLIENTE</span><span>UBICACIÓN</span><span>COMANDA</span><span>FECHA</span><span>ESTADO</span><span></span></div>{orders.map((order) => <div className="customer-row" key={order.id}><div className="customer-name"><b style={{ backgroundColor: order.customer?.color }}>{order.customer?.initials}</b><strong>{order.customer?.name}</strong></div><span><MapPin size={15}/>{order.customer?.location}</span><strong>{formatMoney(order.total)}</strong><span>{formatDate(order.delivery_date)}</span><button className="status-button" disabled={savingOrderId === order.id || !nextStatus[order.status]} onClick={() => onStatusChange(order)}><Status status={order.status}/><ChevronRight size={14}/></button><button className="round-action" disabled={savingOrderId === order.id || !nextStatus[order.status]} onClick={() => onStatusChange(order)}><ChevronRight size={17}/></button></div>)}</div></section></main></div>
}

const adminOrderStatuses = ['pending', 'cancelled', 'delivered']
const adminStatusValue = (status) => ['cancelled', 'delivered'].includes(status) ? status : 'pending'

function AdminStatusMenu({ order, onStatusChange, saving }) {
  const [open, setOpen] = useState(false)
  const current = adminStatusValue(order.status)
  const terminal = ['delivered', 'cancelled'].includes(order.status)
  useEffect(() => setOpen(false), [order.status, saving])

  return <div className={`order-status-menu ${open ? 'open' : ''} ${terminal ? 'terminal' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button type="button" className="order-status-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={saving || terminal} onClick={() => setOpen((value) => !value)}><span className={`status-dot status-${current}`}/><strong>{statusLabel[current]}</strong>{!terminal && <ChevronDown size={15}/>}</button>
    {open && <div className="order-status-options" role="listbox" aria-label={`Estado del pedido ${orderNumber(order)}`}>{adminOrderStatuses.map((status) => <button type="button" role="option" aria-selected={status === current} className={status === current ? 'selected' : ''} key={status} onClick={() => { setOpen(false); if (status !== current) onStatusChange(order, status) }}><span className={`status-dot status-${status}`}/><span>{statusLabel[status]}</span>{status === current && <Check size={15}/>}</button>)}</div>}
  </div>
}

function OrderDetail({ order, showHeader = true }) {
  return <div className="order-detail-content">
    {showHeader && <div className="order-detail-heading"><div><span>COMANDA {orderNumber(order)}</span><strong>{order.items.length} {order.items.length === 1 ? 'producto' : 'productos'}</strong></div><strong>{formatMoney(order.total)}</strong></div>}
    <div className="order-detail-items">
      <div className="order-detail-items-head"><span>Producto</span><span>Cantidad</span><span>Precio unitario</span><span>Subtotal</span></div>
      {order.items.map((item) => <div className="order-detail-item" key={`${order.id}-${item.product_id}`}><strong>{item.product?.name || COPY.productUnavailable}</strong><span>{item.quantity} {item.product?.unit || ''}</span><span>{formatMoney(item.unit_price)}</span><strong>{formatMoney(item.quantity * item.unit_price)}</strong></div>)}
    </div>
    {order.notes && <div className="order-detail-note"><span>Nota de entrega</span><p>{order.notes}</p></div>}
  </div>
}

function AdminOrdersPane({ orders, onStatusChange, savingOrderId }) {
  const [openOrderId, setOpenOrderId] = useState('')
  return <section className="admin-tab-panel"><div className="customers-table admin-orders-table"><div className="customers-head"><span>CLIENTE</span><span>UBICACIÓN</span><span>COMANDA</span><span>ENTREGA</span><span>ESTADO</span><span>DETALLE</span></div>{orders.map((order) => {
    const open = openOrderId === order.id
    return <article className={`admin-order-entry ${open ? 'open' : ''}`} key={order.id}><div className="customer-row admin-order-row"><div className="customer-name"><b style={{ backgroundColor: order.customer?.color }}>{order.customer?.initials || 'SP'}</b><strong>{order.customer?.name || 'Panadería'}</strong></div><span><MapPin size={15}/>{order.customer?.city || order.customer?.location || '—'}</span><strong>{formatMoney(order.total)}</strong><span>{formatDate(order.delivery_date)}</span><AdminStatusMenu order={order} onStatusChange={onStatusChange} saving={savingOrderId === order.id}/><button type="button" className="order-detail-toggle" aria-expanded={open} aria-controls={`order-detail-${order.id}`} onClick={() => setOpenOrderId(open ? '' : order.id)}><span>{open ? 'Ocultar' : 'Ver comanda'}</span><ChevronDown size={16}/></button></div>{open && <div className="order-detail-panel" id={`order-detail-${order.id}`}><OrderDetail order={order}/></div>}</article>
  })}{!orders.length && <p className="empty-copy admin-empty">Todavía no hay pedidos para mostrar.</p>}</div></section>
}

function AdminCustomersPane({ customers, orders, onInvite, inviting, onOpenCustomer }) {
  const rankedCustomers = customers.map((customer) => {
    const customerOrders = orders.filter((order) => order.customer_id === customer.id)
    const total = customerOrders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.total, 0)
    return { customer, customerOrders, total }
  }).sort((a, b) => b.total - a.total || a.customer.name.localeCompare(b.customer.name, 'es'))
  return <section className="admin-tab-panel"><div className="admin-client-list">{rankedCustomers.map(({ customer, customerOrders, total }) => {
    return <article className="admin-client-entry" key={customer.id}><button type="button" className="admin-client-card" aria-label={`Abrir ficha de ${customer.name}`} onClick={() => onOpenCustomer(customer.id)}><b style={{ backgroundColor: customer.color }}>{customer.initials}</b><div><strong>{customer.name}</strong><span>{customer.city || customer.location} · {customerOrders.length} {customerOrders.length === 1 ? 'pedido' : 'pedidos'} · Código {customerCode(customer)}</span></div><div><small>Facturación acumulada</small><strong>{formatMoney(total)}</strong></div><span className={`customer-activity ${customer.is_active ? 'active' : ''}`}>{customer.is_active ? 'Activa' : 'Pausada'}</span><ChevronRight className="client-card-chevron" size={18}/></button></article>
  })}{!customers.length && <p className="empty-copy">Todavía no hay panaderías invitadas.</p>}</div><InviteCustomer onInvite={onInvite} saving={inviting}/></section>
}

function ClientOrderHistoryItem({ order }) {
  const [open, setOpen] = useState(false)
  const status = adminStatusValue(order.status)
  return <article className={`client-history-order ${open ? 'open' : ''}`}><button type="button" className="client-history-order-trigger" aria-expanded={open} aria-controls={`client-order-${order.id}`} onClick={() => setOpen((value) => !value)}><strong className="client-order-code">Comanda {orderNumber(order)}</strong><span className="client-order-date">{formatOrderCreated(order.created_at)}</span><span className={`client-order-state status-${status}`}><i/>{statusLabel[status]}</span><strong className="client-order-total">{formatMoney(order.total)}</strong><ChevronDown size={17}/></button>{open && <div className="client-history-order-detail" id={`client-order-${order.id}`}><OrderDetail order={order} showHeader={false}/></div>}</article>
}

function AdminCustomerDetailPane({ customer, orders, onBack }) {
  const customerOrders = orders.filter((order) => order.customer_id === customer.id)
  const billedOrders = customerOrders.filter((order) => order.status !== 'cancelled')
  const total = billedOrders.reduce((sum, order) => sum + order.total, 0)
  const products = productTotals(billedOrders)
  const favorite = products[0]
  return <section className="admin-tab-panel client-profile-screen"><button type="button" className="client-back-button" onClick={onBack}><ChevronRight size={17}/> Volver a clientes</button><div className="client-profile-hero"><b style={{ backgroundColor: customer.color }}>{customer.initials}</b><div><span>CLIENTE · {customerCode(customer)}</span><h2>{customer.name}</h2><p><MapPin size={14}/>{customer.address_line_1 || customer.location || 'Sin dirección'}{customer.city ? `, ${customer.city}` : ''}</p></div><span className={`customer-activity ${customer.is_active ? 'active' : ''}`}>{customer.is_active ? 'Activa' : 'Pausada'}</span></div><div className="client-detail-metrics"><div><strong>{formatMoney(total)}</strong><span>FACTURACIÓN TOTAL</span></div><div><strong>{customerOrders.length}</strong><span>COMANDAS</span></div><div className="favorite-product-metric"><strong>{favorite ? `${favorite.name} · ${favorite.quantity} ${favorite.unit}` : 'Sin pedidos'}</strong><span>PRODUCTO MÁS PEDIDO</span></div></div><div className="client-order-history"><div className="client-order-history-title"><span>HISTORIAL DE COMANDAS</span><strong>{customerOrders.length}</strong></div>{customerOrders.length > 0 && <div className="client-order-list-head"><span>COMANDA</span><span>FECHA DE CREACIÓN</span><span>ESTADO</span><span>TOTAL</span><span></span></div>}<div className="client-order-list">{customerOrders.map((order) => <ClientOrderHistoryItem order={order} key={order.id}/>)}</div>{!customerOrders.length && <div className="client-no-orders"><Package size={25}/><p>Esta panadería todavía no realizó pedidos.</p></div>}</div></section>
}

function AdminWorkspace({ orders, customers, products, onStatusChange, onProductSave, onProductCreate, onInvite, savingOrderId, savingProductId, creatingProduct, inviting, onLogout }) {
  const initialLocation = adminLocationFromPath()
  const [tab, setTab] = useState(initialLocation.tab)
  const [selectedCustomerId, setSelectedCustomerId] = useState(() => customers.find((customer) => customer.slug === initialLocation.customerSlug)?.id || '')
  const [period, setPeriod] = useState('Hoy')
  const [topMetric, setTopMetric] = useState('quantity')
  const navigateAdmin = (nextTab, customerId = '', replace = false) => {
    setTab(nextTab)
    setSelectedCustomerId(customerId)
    const customer = customerId ? customers.find((item) => item.id === customerId) : null
    const path = customer ? `/admin/clientes/${encodeURIComponent(customer.slug)}` : adminRoutes[nextTab] || adminRoutes.summary
    updateBrowserPath(path, replace)
  }
  useEffect(() => {
    if (!window.location.pathname.startsWith('/admin')) navigateAdmin('summary', '', true)
    const onPopState = () => {
      const location = adminLocationFromPath()
      setTab(location.tab)
      setSelectedCustomerId(customers.find((customer) => customer.slug === location.customerSlug)?.id || '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [customers])
  const periodOrders = useMemo(() => ordersForPeriod(orders, period), [orders, period])
  const salesOrders = useMemo(() => periodOrders.filter((order) => order.status !== 'cancelled'), [periodOrders])
  const ranking = useMemo(() => productSales(salesOrders, topMetric).slice(0, 4), [salesOrders, topMetric])
  const revenue = salesOrders.reduce((sum, order) => sum + order.total, 0)
  const soldQuantity = salesOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)
  const soldKg = salesOrders.reduce((sum, order) => sum + order.totalKg, 0)
  const periodLabel = period === 'Hoy' ? 'de hoy' : period === 'Semana' ? 'de esta semana' : 'de este mes'
  const sections = [
    { id: 'summary', label: 'Resumen', icon: LayoutDashboard },
    { id: 'orders', label: 'Pedidos', icon: Package },
    { id: 'customers', label: 'Clientes', icon: Store },
    { id: 'products', label: 'Productos', icon: ShoppingBag },
  ]
  const pageHeaders = {
    summary: { eyebrow: 'PANEL DE CONTROL', title: 'Buenos días, administración', subtitle: '' },
    orders: { eyebrow: 'OPERACIÓN', title: 'Pedidos de clientes', subtitle: 'Gestioná importes, entregas y estados desde un solo lugar.' },
    customers: { eyebrow: 'RED DE CLIENTES', title: 'Panaderías clientes', subtitle: 'Actividad y facturación de cada cuenta asociada.' },
    products: { eyebrow: 'CATÁLOGO GLOBAL', title: 'Productos y precios', subtitle: 'Administrá la oferta disponible para todas las panaderías.' },
  }
  const selectedCustomer = tab === 'customers' ? customers.find((customer) => customer.id === selectedCustomerId) : null
  const pageHeader = selectedCustomer
    ? { eyebrow: `CLIENTE · ${customerCode(selectedCustomer)}`, title: selectedCustomer.name, subtitle: 'Historial, facturación y productos más pedidos.' }
    : pageHeaders[tab]
  const rankingLabel = topMetric === 'revenue' ? 'Facturación' : topMetric === 'kilograms' ? 'Kilos vendidos' : 'Cantidad vendida'
  const rankingValue = (product) => topMetric === 'revenue' ? formatMoney(product.revenue) : topMetric === 'kilograms' ? `${product.kilograms.toFixed(1)} kg` : `${product.quantity} ${product.unit}`
  const overview = <div className="dashboard-overview" key={period}>
    <section className="admin-kpis"><AdminMetric label="Facturación" value={formatMoney(revenue)} diff={periodLabel} tone="orange"/><AdminMetric label="Pedidos" value={salesOrders.length} diff={periodLabel} tone="blue"/><AdminMetric label="Unidades vendidas" value={soldQuantity.toFixed(soldQuantity % 1 ? 1 : 0)} diff="Suma de todas las unidades" tone="green"/><AdminMetric label="Kilos vendidos" value={`${soldKg.toFixed(1)} kg`} diff="Productos vendidos por peso" tone="pink"/></section>
    <section className="admin-grid"><article className="admin-chart-card"><div className="chart-heading"><div><span className="section-label">PEDIDOS</span><h2>Órdenes por estado</h2></div></div><div className="bar-chart">{adminOrderStatuses.map((status) => { const count = periodOrders.filter((order) => adminStatusValue(order.status) === status).length; return <div className="bar-column" key={status}><i className="today" style={{ height: `${Math.max(8, count / Math.max(periodOrders.length, 1) * 100)}%` }}/><strong>{count}</strong><span>{statusLabel[status]}</span></div> })}</div></article><article className="production-card"><div className="chart-heading ranking-heading"><div><span className="section-label">PRODUCTOS</span><h2>Top productos</h2></div><label className="ranking-select"><span>Ordenar por</span><select value={topMetric} onChange={(event) => setTopMetric(event.target.value)}><option value="quantity">Cantidad</option><option value="revenue">Facturación</option><option value="kilograms">Kilos</option></select><ChevronDown size={14}/></label></div><p className="ranking-context">{rankingLabel} {periodLabel}</p>{ranking.map((product) => <div className="production-item" key={`${product.id}-${topMetric}`}><div><strong>{product.name}</strong><span>{rankingValue(product)}</span></div></div>)}{!ranking.length && <p className="empty-copy">Sin ventas para este período.</p>}</article></section>
  </div>
  const panel = tab === 'summary' ? overview : tab === 'orders' ? <AdminOrdersPane orders={orders} onStatusChange={onStatusChange} savingOrderId={savingOrderId}/> : tab === 'customers' ? selectedCustomer ? <AdminCustomerDetailPane customer={selectedCustomer} orders={orders} onBack={() => navigateAdmin('customers')}/> : <AdminCustomersPane customers={customers} orders={orders} onInvite={onInvite} inviting={inviting} onOpenCustomer={(customerId) => navigateAdmin('customers', customerId)}/> : <section className="admin-tab-panel"><ProductManager products={products} onSave={onProductSave} onCreate={onProductCreate} savingId={savingProductId} creating={creatingProduct}/></section>
  return <div className="admin-shell admin-layout"><aside className="admin-sidebar"><Brand dark/><div className="admin-sidebar-label">ADMINISTRACIÓN</div><nav>{sections.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigateAdmin(id)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="admin-sidebar-footer"><div className="admin-profile"><div>SP</div><span>Admin Seven Pan</span></div><button onClick={onLogout} className="admin-exit"><LogOut size={18}/> Cerrar sesión</button></div></aside><div className="admin-workspace"><header className="admin-topbar dashboard-topbar"><div className="dashboard-header-copy" key={`${tab}-${selectedCustomerId}`}><span className="eyebrow warm">{pageHeader.eyebrow}</span><h1>{pageHeader.title}</h1>{pageHeader.subtitle && <p>{pageHeader.subtitle}</p>}</div><div className="admin-topbar-actions">{tab === 'summary' && <div className="period-tabs">{['Hoy', 'Semana', 'Mes'].map((item) => <button key={item} onClick={() => setPeriod(item)} className={period === item ? 'active' : ''}>{item}</button>)}</div>}<button className="notification" aria-label="Notificaciones"><Bell size={19}/><i/></button></div></header><main className="admin-content">{panel}</main></div></div>
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [workspace, setWorkspace] = useState({ products: [], customers: [], orders: [] })
  const [view, setView] = useState(() => customerViewFromPath())
  const [quantities, setQuantities] = useState({})
  const [editingOrder, setEditingOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [savingOrderId, setSavingOrderId] = useState('')
  const [savingProductId, setSavingProductId] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [toast, setToast] = useState('')

  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 3200) }
  const currentCustomer = workspace.customers[0]
  const navigateView = (nextView, replace = false) => {
    setView(nextView)
    updateBrowserPath(customerRoutes[nextView] || customerRoutes.home, replace)
  }

  const refresh = async (activeSession = session) => {
    if (!activeSession?.user) return
    setLoading(true); setError('')
    try {
      const nextProfile = await getMyProfile(activeSession.user.id)
      const data = await loadWorkspace(nextProfile)
      setProfile(nextProfile); setWorkspace(data)
    } catch (loadError) {
      setError(loadError.message || 'No pudimos cargar tu operación.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const onPopState = () => setView(customerViewFromPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => { if (session) refresh(session); else { setProfile(null); setWorkspace({ products: [], customers: [], orders: [] }); setLoading(false) } }, [session])
  useEffect(() => session ? subscribeToCatalog(() => refresh(session)) : undefined, [session])
  useEffect(() => {
    if (profile?.role !== 'customer') return
    if (window.location.pathname.startsWith('/admin') || !Object.values(customerRoutes).includes(window.location.pathname)) navigateView('home', true)
  }, [profile])

  const handleLogin = async (email, password) => {
    setSubmitting(true); setLoginError('')
    try { await signIn(email, password) } catch (login) { setLoginError(login.message || 'No pudimos iniciar sesión.') } finally { setSubmitting(false) }
  }
  const handleLogout = async () => { await signOut(); setView('home'); updateBrowserPath('/', true); setQuantities({}); setEditingOrder(null) }
  const updateQuantity = (id, amount) => setQuantities((current) => {
    const next = Math.max(0, (current[id] || 0) + amount)
    if (!next) { const { [id]: ignored, ...rest } = current; return rest }
    return { ...current, [id]: next }
  })
  const repeat = (order) => { if (!order) return; setQuantities(Object.fromEntries(order.items.map((item) => [item.product_id, item.quantity]))); setEditingOrder(null); navigateView('catalog'); notify('Copiamos las cantidades con los precios actuales.') }
  const editOrder = (order) => { setQuantities(Object.fromEntries(order.items.map((item) => [item.product_id, item.quantity]))); setEditingOrder(order); navigateView('catalog') }
  const submitOrder = async ({ deliveryDate, notes }) => {
    const items = Object.entries(quantities).map(([productId, quantity]) => ({ productId, quantity }))
    if (!items.length) return
    setSubmitting(true)
    try {
      if (editingOrder) await apiRequest(`orders/${editingOrder.id}`, { method: 'PATCH', body: { items, deliveryDate, notes } })
      else await apiRequest('orders', { body: { items, deliveryDate, notes } })
      setQuantities({}); setEditingOrder(null); await refresh(); navigateView('orders'); notify(editingOrder ? COPY.orderUpdated : COPY.orderCreated)
    } catch (saveError) { notify(saveError.message || 'No pudimos guardar la comanda.') } finally { setSubmitting(false) }
  }
  const cancelOrder = async (order) => {
    setSavingOrderId(order.id)
    try { await apiRequest(`orders/${order.id}`, { method: 'DELETE' }); await refresh(); notify(`Pedido ${orderNumber(order)} cancelado.`) } catch (cancelError) { notify(cancelError.message || 'No pudimos cancelar la comanda.') } finally { setSavingOrderId('') }
  }
  const advanceStatus = async (order, status) => {
    if (!status || status === order.status) return
    setSavingOrderId(order.id)
    try { await apiRequest(`admin/orders/${order.id}/status`, { method: 'PATCH', body: { status } }); await refresh(); notify(`Pedido ${orderNumber(order)}: ${statusLabel[status]}.`) } catch (updateError) { notify(updateError.message || 'No pudimos actualizar el pedido.') } finally { setSavingOrderId('') }
  }
  const saveProduct = async (product, changes) => {
    if (changes.price !== undefined && (!Number.isFinite(changes.price) || changes.price < 0)) return notify('Ingresá un precio válido.')
    setSavingProductId(product.id)
    try { await apiRequest(`admin/products/${product.id}`, { method: 'PATCH', body: changes }); await refresh(); notify(`Actualizamos ${product.name} para todas las panaderías.`) } catch (updateError) { notify(updateError.message || 'No pudimos actualizar el producto.') } finally { setSavingProductId('') }
  }
  const createProduct = async (form) => {
    setCreatingProduct(true)
    try { await apiRequest('admin/products', { body: form }); await refresh(); notify(`${form.name} ya está disponible para todas las panaderías.`); return true } catch (createError) { notify(createError.message || 'No pudimos agregar el producto.'); return false } finally { setCreatingProduct(false) }
  }
  const saveProfile = async (form) => {
    setSavingProfile(true)
    const body = {
      ...(form.addressLine1.trim() ? { addressLine1: form.addressLine1.trim() } : {}),
      ...(form.city.trim() ? { city: form.city.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      deliveryNotes: form.deliveryNotes.trim() || null,
    }
    try { await apiRequest('me', { method: 'PATCH', body }); await refresh(); notify(COPY.profileSaved) } catch (saveError) { notify(saveError.message || 'No pudimos guardar tus datos.') } finally { setSavingProfile(false) }
  }
  const inviteCustomer = async (form) => {
    setInviting(true)
    try { await apiRequest('admin/customers/invite', { body: form }); await refresh(); notify(`Invitación enviada a ${form.email}.`) } catch (inviteError) { notify(inviteError.message || 'No pudimos enviar la invitación.') } finally { setInviting(false) }
  }

  if (loading && session) return <Loading message="Estamos consultando tus permisos y datos." />
  if (!session) return <Login onSignIn={handleLogin} submitting={submitting} error={loginError} />
  if (error) return <Loading error={error} retry={refresh} />
  if (!profile) return <Loading message="Estamos preparando tu perfil." />
  if (profile?.role === 'admin') return <><AdminWorkspace {...workspace} onStatusChange={advanceStatus} onProductSave={saveProduct} onProductCreate={createProduct} onInvite={inviteCustomer} savingOrderId={savingOrderId} savingProductId={savingProductId} creatingProduct={creatingProduct} inviting={inviting} onLogout={handleLogout}/><Toast message={toast}/></>

  const pages = {
    home: <BakeryHome quantities={quantities} products={workspace.products} orders={workspace.orders} setView={navigateView} onRepeat={repeat}/>,
    catalog: <Catalog quantities={quantities} products={workspace.products} updateQuantity={updateQuantity} onSubmit={submitOrder} submitting={submitting} editingOrder={editingOrder} onCancelEdit={() => { setEditingOrder(null); setQuantities({}); navigateView('orders') }}/>,
    orders: <Orders orders={workspace.orders} onRepeat={repeat} onEdit={editOrder} onCancel={cancelOrder} cancellingId={savingOrderId}/>,
    stats: <Stats orders={workspace.orders}/>,
    profile: <CustomerProfile customer={currentCustomer} onSave={saveProfile} saving={savingProfile}/>,
  }
  return <div className="app-shell"><Sidebar view={view} setView={navigateView} profile={profile} customer={currentCustomer} onLogout={handleLogout}/><div className="main-area">{pages[view] || pages.home}</div><Toast message={toast}/></div>
}
