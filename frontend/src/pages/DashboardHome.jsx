import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { dataQuery } from '../api.js'
import StatCard from '../components/ui/StatCard'
import { PageHeader } from '../components/ui/Panel'
import {
  IconChat, IconAnalytics, IconNetwork, IconProfiler, IconForecast,
  IconSociological, IconFinancial, IconReports, IconTimeline, IconBriefing, IconAlert,
} from '../components/ui/Icons'

const ROLE_WELCOME = {
  admin:        'Full system access enabled. All modules active.',
  supervisor:   'You have approval authority over all active cases.',
  analyst:      'Analytics and intelligence modules are available.',
  investigator: 'Your assigned cases are ready for review.',
  policymaker:  'Aggregated intelligence dashboards are loaded.',
}

const MODULES = [
  { id:'briefing',     Icon:IconBriefing,     label:'AI Intel Briefing',    desc:'One-click narrative combining live alerts, anomalies, MO patterns, and forecast.', badge:'NEW', route:'/dashboard/briefing' },
  { id:'chat',         Icon:IconChat,         label:'Conversational AI',    desc:'Natural language queries in English & ಕನ್ನಡ. Voice input. Context-aware conversations.', badge:'MAIN', route:'/dashboard/chat' },
  { id:'analytics',    Icon:IconAnalytics,    label:'Pattern Analytics',    desc:'Crime trends, district breakdown, seasonal patterns, demographic analysis.', route:'/dashboard/analytics' },
  { id:'network',      Icon:IconNetwork,      label:'Network Relations',    desc:'Criminal relationship graph, organized crime detection, financial linkage.', route:'/dashboard/network' },
  { id:'profiler',     Icon:IconProfiler,     label:'Criminal Profiler',    desc:'Behavioral profiling, risk scoring, modus operandi, investigative leads.', route:'/dashboard/profiler' },
  { id:'caseinsight',  Icon:IconTimeline,     label:'Case Insight',         desc:'Investigation timeline, similar past cases, explainable match scoring.', route:'/dashboard/case-insight' },
  { id:'forecast',     Icon:IconForecast,     label:'Crime Forecasting',    desc:'AI hotspot prediction, early warning alerts, 72h crime forecasts.', route:'/dashboard/forecast' },
  { id:'sociological', Icon:IconSociological, label:'Sociological Insights', desc:'Age, gender, religion, caste, occupation correlation with crime patterns.', route:'/dashboard/sociological' },
  { id:'financial',    Icon:IconFinancial,    label:'Financial Crime',      desc:'Money-flow graph, flagged accounts, laundering indicators.', route:'/dashboard/financial' },
  { id:'reports',      Icon:IconReports,      label:'Reporting',            desc:'Export district, offender, and hotspot reports as CSV, Excel, or PDF.', route:'/dashboard/reports' },
]

// Shown only while the live alert computation is loading — replaced by real
// alerts derived from CaseMaster/Accused/FinancialAccounts (anomaly z-scores,
// repeat-offender risk, recurring MO clusters) via the `alerts` action.
const PLACEHOLDER_ALERTS = [
  { msg: 'Computing live intelligence signals…', sev: 'INFO' },
]

export default function DashboardHome() {
  const { user, role } = useAuth()
  const navigate = useNavigate()
  const name = user?.first_name || user?.email?.split('@')[0] || 'Officer'
  const now = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const [liveStats, setLiveStats] = useState(null)
  const [liveAlerts, setLiveAlerts] = useState(null)

  useEffect(() => {
    dataQuery('dashboard').then(d => { if (d?.stats) setLiveStats(d.stats) }).catch(() => {})
    dataQuery('alerts').then(d => { if (d?.alerts?.length) setLiveAlerts(d.alerts) }).catch(() => {})
  }, [])

  const alerts = liveAlerts
    ? liveAlerts.slice(0, 3).map(a => ({ msg: `${a.type}: ${a.msg}`, sev: a.severity }))
    : PLACEHOLDER_ALERTS

  const stats = [
    { label:'Total Cases',        value: liveStats?.total_firs,        sub: liveStats ? `${liveStats.total_accused} accused · ${liveStats.total_victims} victims` : '', color:'accent' },
    { label:'Open Cases',         value: liveStats?.open_cases,         sub: liveStats ? `${Math.round((liveStats.open_cases/(liveStats.total_firs||1))*100)}% of total` : '', color:'high' },
    { label:'Repeat Offenders',   value: liveStats?.repeat_offenders,   sub: liveStats ? `${Math.round((liveStats.repeat_offenders/(liveStats.total_accused||1))*100)}% of accused` : '', color:'critical' },
    { label:'Charge Sheeted',     value: liveStats?.chargesheeted,      sub: liveStats ? `${Math.round((liveStats.chargesheeted/(liveStats.total_firs||1))*100)}% of cases` : '', color:'low' },
  ]

  return (
    <div className="p-7 space-y-6">
      <PageHeader
        eyebrow="KAVACH Intelligence Platform"
        title={`Welcome, ${name}`}
        subtitle={ROLE_WELCOME[role] || 'Ready for duty.'}
        right={
          <div className="text-right">
            <p className="text-ink-faint text-[11px] tracking-wide uppercase">{now}</p>
            <span className="mt-1.5 inline-flex items-center gap-1.5 bg-risk-low/10 border border-risk-low/25 rounded-md px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-risk-low animate-pulse" />
              <span className="text-risk-low text-[10px] tracking-wide font-mono">SYSTEM ONLINE</span>
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s, i) => <StatCard key={s.label} {...s} loading={!liveStats} style={{ animationDelay: `${i * 40}ms` }} />)}
      </div>

      <div className="bg-risk-critical/[0.05] border border-risk-critical/15 rounded-2xl px-4 py-3 flex items-center gap-4 flex-wrap animate-fade-up">
        <span className="text-risk-critical text-[10px] font-mono font-bold tracking-widest flex-shrink-0 flex items-center gap-1.5"><IconAlert className="w-3.5 h-3.5" /> LIVE ALERTS</span>
        {alerts.map((a, i) => (
          <span key={i} className="text-[11px] font-mono text-ink-dim border-l border-base-border pl-3">
            <span className={`font-bold ${a.sev === 'CRITICAL' ? 'text-risk-critical' : a.sev === 'HIGH' ? 'text-risk-high' : 'text-ink-faint'}`}>[{a.sev}]</span> {a.msg}
          </span>
        ))}
      </div>

      <div>
        <h2 className="kv-eyebrow mb-3">Modules</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {MODULES.map((m, i) => (
            <button
              key={m.id}
              onClick={() => navigate(m.route)}
              style={{ animationDelay: `${i * 30}ms` }}
              className={`text-left kv-panel p-5 transition-all hover:-translate-y-0.5 animate-fade-up group ${
                m.badge ? 'border-accent/30 bg-accent/[0.04] hover:shadow-glow' : 'hover:border-accent/30'
              }`}
            >
              <div className="flex justify-between items-start mb-2.5">
                <span className="w-9 h-9 rounded-lg bg-base-raised border border-base-border flex items-center justify-center text-ink-dim group-hover:text-white group-hover:border-accent/40 transition-colors">
                  <m.Icon className="w-[18px] h-[18px]" />
                </span>
                {m.badge && <span className="bg-accent text-base text-[9px] font-bold font-mono tracking-widest px-1.5 py-0.5 rounded">{m.badge}</span>}
              </div>
              <p className="text-white text-sm font-semibold mb-1.5">{m.label}</p>
              <p className="text-ink-faint text-[11px] leading-relaxed font-mono">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
