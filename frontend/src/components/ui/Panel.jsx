import AnimatedNumber from './AnimatedNumber'
import { IconAlert, IconInfo, IconCheck } from './Icons'

export default function Panel({ title, action, children, span, className = '' }) {
  return (
    <div className={`kv-panel p-5 animate-fade-up ${span ? 'md:col-span-2' : ''} ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4 gap-3">
          {title && <h2 className="kv-eyebrow">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function PageHeader({ eyebrow, title, subtitle, right }) {
  return (
    <div className="border-b border-base-border pb-4 flex justify-between items-end flex-wrap gap-3 animate-fade-up">
      <div>
        {eyebrow && <p className="kv-eyebrow mb-1">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-bold tracking-tight text-white text-wrap-balance">{title}</h1>
        {subtitle && <p className="text-[11px] text-ink-faint mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

// Advisory strip shown at the bottom of analytic pages — consistent icon,
// tone colour, and spacing (replaces ad-hoc emoji + coloured text rows).
const CALLOUT_TONE = {
  info:     { color: '#A1A1A1', Icon: IconInfo,  border: 'border-base-border' },
  warning:  { color: '#F0A23D', Icon: IconAlert, border: 'border-risk-high/25' },
  success:  { color: '#2CB67D', Icon: IconCheck, border: 'border-risk-low/25' },
  critical: { color: '#F1493F', Icon: IconAlert, border: 'border-risk-critical/25' },
}

export function Callout({ tone = 'info', children }) {
  const t = CALLOUT_TONE[tone] || CALLOUT_TONE.info
  return (
    <div className={`bg-base-panel border ${t.border} rounded-xl p-4 flex items-start gap-3 animate-fade-up`}>
      <span className="flex-shrink-0 mt-0.5" style={{ color: t.color }} aria-hidden><t.Icon className="w-4 h-4" /></span>
      <p className="text-xs leading-relaxed" style={{ color: `${t.color}CC` }}>{children}</p>
    </div>
  )
}

// KPI stat tile used on every analytic page — same top accent bar, radial
// tint, entrance stagger, and hover lift everywhere.
export function KpiCard({ label, value, sub, color = '#FFFFFF', isText = false, delay = 0 }) {
  return (
    <div
      className="kv-card p-4 relative overflow-hidden animate-fade-up hover:-translate-y-0.5 transition-transform duration-200"
      style={{ borderTop: `2px solid ${color}`, animationDelay: `${delay}ms` }}
    >
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ background: `radial-gradient(circle at top right, ${color}, transparent 70%)` }} />
      <p className={`font-display font-bold tabular ${isText ? 'text-lg' : 'text-3xl'}`} style={{ color }}>
        {isText ? value : <AnimatedNumber value={value} />}
      </p>
      <p className="text-[10px] text-ink-dim uppercase tracking-widest mt-1">{label}</p>
      {sub && <p className="text-[10px] text-ink-faint mt-0.5">{sub}</p>}
    </div>
  )
}
