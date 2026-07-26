import AnimatedNumber from './AnimatedNumber'

const COLOR_MAP = {
  accent: { text: 'text-accent', bg: 'from-accent/10' },
  critical: { text: 'text-risk-critical', bg: 'from-risk-critical/10' },
  high: { text: 'text-risk-high', bg: 'from-risk-high/10' },
  low: { text: 'text-risk-low', bg: 'from-risk-low/10' },
  violet: { text: 'text-[#A78BFA]', bg: 'from-[#A78BFA]/10' },
  blue: { text: 'text-[#60A5FA]', bg: 'from-[#60A5FA]/10' },
}

export default function StatCard({ label, value, sub, color = 'accent', icon, isText = false, loading = false, style }) {
  const c = COLOR_MAP[color] || COLOR_MAP.accent
  if (loading) {
    return (
      <div className="kv-panel p-4" style={style}>
        <div className="skeleton h-8 w-20 mb-3" />
        <div className="skeleton h-3 w-24" />
      </div>
    )
  }
  return (
    <div style={style} className="kv-panel relative overflow-hidden p-4 animate-fade-up transition-transform hover:-translate-y-0.5 hover:shadow-glow">
      <div className={`absolute inset-0 bg-gradient-to-br ${c.bg} to-transparent opacity-60 pointer-events-none`} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-display font-bold text-3xl tabular ${c.text}`}>
            {isText ? value : <AnimatedNumber value={value} />}
          </p>
          <p className="text-[10px] text-ink-dim uppercase tracking-widest mt-1.5 truncate">{label}</p>
          {sub && <p className="text-[10px] text-ink-faint mt-0.5 truncate">{sub}</p>}
        </div>
        {icon && <span className="text-lg opacity-70 flex-shrink-0">{icon}</span>}
      </div>
    </div>
  )
}
