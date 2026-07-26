import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

const STYLES = {
  info:    { border: 'border-accent/40',       icon: 'ℹ' },
  success: { border: 'border-risk-low/40',     icon: '✓' },
  warning: { border: 'border-risk-high/40',    icon: '⚠' },
  error:   { border: 'border-risk-critical/40', icon: '✕' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((message, type = 'info', duration = 3200) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] space-y-2 w-80 max-w-[90vw]">
        {toasts.map(t => {
          const s = STYLES[t.type] || STYLES.info
          return (
            <div key={t.id} className={`kv-panel ${s.border} px-4 py-3 flex items-start gap-2.5 animate-fade-up shadow-panel`}>
              <span className="text-sm flex-shrink-0">{s.icon}</span>
              <p className="text-xs text-ink leading-relaxed">{t.message}</p>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
