import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './architecture.css'
import App from './App'
import { BRAND } from './lib/copy.es'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, details) {
    console.error('Error de interfaz de sevenpan', error, details)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="login-shell">
      <section className="login-copy"><div className="login-hero"><span className="eyebrow">{BRAND.fullName.toUpperCase()}</span><h1>No pudimos abrir tu panel.</h1><p>Recargá la página. Si el problema continúa, contactá a administración.</p></div></section>
      <section className="login-form-wrap"><div className="loading-panel"><p>{import.meta.env.DEV ? this.state.error.message : 'El error fue registrado para revisarlo.'}</p><button className="primary-button" onClick={() => window.location.reload()}>Recargar</button></div></section>
    </main>
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
)
