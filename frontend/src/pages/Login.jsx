import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import KavachLogo from '../components/ui/KavachLogo'
import { IconEye, IconEyeOff, IconAlert, IconBolt } from '../components/ui/Icons'

const ROLE_HOME = {
  admin:        '/dashboard',
  supervisor:   '/dashboard',
  investigator: '/dashboard',
  analyst:      '/analytics',
  policymaker:  '/analytics',
}

const DEV_ACCOUNTS = [
  { email: 'admin@ksp.gov.in',        role: 'Admin'        },
  { email: 'supervisor@ksp.gov.in',   role: 'Supervisor'   },
  { email: 'investigator@ksp.gov.in', role: 'Investigator' },
  { email: 'analyst@ksp.gov.in',      role: 'Analyst'      },
  { email: 'policymaker@ksp.gov.in',  role: 'Policymaker'  },
]

const ROLE_BRIEF = [
  { role: 'Investigator', desc: 'FIRs, accused profiles, network analysis', color: 'bg-[#60A5FA]' },
  { role: 'Analyst',      desc: 'Crime trends, hotspots, forecasting',       color: 'bg-risk-low' },
  { role: 'Supervisor',   desc: 'Full access + team oversight',              color: 'bg-[#A78BFA]' },
  { role: 'Policymaker',  desc: 'Aggregated insights, prevention strategy', color: 'bg-risk-high' },
]

export default function Login() {
  const { login, error, setError } = useAuth()
  const navigate = useNavigate()

  const [form, setForm]         = useState({ email: '', password: '' })
  const [loading, setLoading]   = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleChange = (e) => {
    setError?.(null)
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) return
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      navigate(ROLE_HOME[user?.role] || '/dashboard', { replace: true })
    } catch (_) {
      // error already set in context
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base flex font-sans">

      {/* ── Left — brand panel ─────────────────────────────── */}
      <div className="hidden lg:flex w-[44%] bg-gradient-to-br from-[#0A0A0A] to-[#000000] border-r border-base-border p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 relative">
          <KavachLogo size={40} />
          <div>
            <div className="font-display text-white text-base font-bold tracking-wide">KAVACH</div>
            <div className="text-ink-faint text-[10px] tracking-[0.2em] uppercase">Intelligence Platform</div>
          </div>
        </div>

        <div className="relative animate-fade-up">
          <span className="inline-block bg-accent-soft border border-accent/30 rounded-full px-3 py-1 text-[11px] text-accent tracking-widest uppercase mb-5">
            Powered by KAVACH AI
          </span>
          <h1 className="font-display text-white text-[28px] font-bold leading-tight mb-4 text-wrap-balance">
            Karnataka State Police<br /><span className="text-accent">Crime Analytics</span> Platform
          </h1>
          <p className="text-ink-faint text-[13px] leading-relaxed max-w-[300px]">
            AI-powered crime intelligence for investigators, analysts, supervisors, and policymakers.
          </p>

          <div className="flex gap-6 mt-8">
            {[{ val:'500+', label:'FIR Records' },{ val:'10', label:'Districts' },{ val:'5', label:'Role Levels' }].map(s => (
              <div key={s.label}>
                <div className="text-white font-display text-2xl font-bold tabular">{s.val}</div>
                <div className="text-ink-faint text-[11px] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex flex-col gap-2.5">
          {ROLE_BRIEF.map(({ role, desc, color }) => (
            <div key={role} className="flex items-start gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full ${color} mt-1.5 flex-shrink-0`} />
              <p className="text-xs"><span className="text-white font-semibold">{role}</span><span className="text-ink-faint"> — {desc}</span></p>
            </div>
          ))}
        </div>

        <p className="relative text-ink-faint/60 text-[11px] tracking-wide">
          Karnataka State Police · Authorized Personnel Only
        </p>
      </div>

      {/* ── Right — form ─────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[360px] animate-fade-up">

          <div className="flex lg:hidden items-center gap-2.5 mb-8">
            <KavachLogo size={36} />
            <div>
              <div className="text-white text-[15px] font-display font-bold">KAVACH</div>
              <div className="text-ink-faint text-[10px] tracking-widest">INTELLIGENCE PLATFORM</div>
            </div>
          </div>

          <h2 className="font-display text-white text-xl font-bold mb-1">Sign in to your account</h2>
          <p className="text-ink-faint text-[13px] mb-7">Authorized KSP personnel only. All access is logged.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-ink-dim text-xs font-medium tracking-wide mb-1.5">Official Email</label>
              <input
                type="email" name="email" autoComplete="email" value={form.email} onChange={handleChange}
                placeholder="officer@ksp.gov.in" required
                className="w-full bg-white/5 border border-base-border focus:border-accent rounded-lg px-3.5 py-2.5 text-white text-sm outline-none transition-colors placeholder-ink-faint"
              />
            </div>

            <div>
              <label className="block text-ink-dim text-xs font-medium tracking-wide mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'} name="password" autoComplete="current-password"
                  value={form.password} onChange={handleChange} placeholder="Enter your password" required
                  className="w-full bg-white/5 border border-base-border focus:border-accent rounded-lg px-3.5 py-2.5 pr-11 text-white text-sm outline-none transition-colors placeholder-ink-faint"
                />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  title={showPass ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-dim transition-colors">
                  {showPass ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-risk-critical/10 border border-risk-critical/25 rounded-lg px-3.5 py-2.5 flex items-center gap-2">
                <span className="text-risk-critical flex-shrink-0"><IconAlert className="w-4 h-4" /></span>
                <span className="text-risk-critical text-[13px]">{error}</span>
              </div>
            )}

            <button
              type="submit" disabled={loading || !form.email || !form.password}
              className="w-full bg-gradient-to-r from-accent-strong to-accent disabled:opacity-40 disabled:cursor-not-allowed rounded-lg py-3 text-base font-semibold text-sm tracking-wide flex items-center justify-center gap-2 mt-1 transition-opacity hover:opacity-90"
            >
              {loading ? (<><span className="w-3.5 h-3.5 border-2 border-base/40 border-t-base rounded-full animate-spin" />Authenticating…</>) : 'Access Platform'}
            </button>
          </form>

          <p className="text-center mt-5 text-ink-faint text-[11px]">
            Forgot password? Contact your system administrator.
          </p>

          {import.meta.env.DEV && (
            <div className="mt-6 bg-risk-high/[0.06] border border-risk-high/20 rounded-xl px-4 py-3.5">
              <p className="text-risk-high text-[11px] font-semibold tracking-widest uppercase mb-2.5 flex items-center gap-1.5"><IconBolt className="w-3 h-3" /> Dev — click to fill</p>
              <div className="flex flex-col gap-1">
                {DEV_ACCOUNTS.map(({ email, role }) => (
                  <button
                    key={role} type="button"
                    onClick={() => setForm({ email, password: '1234' })}
                    className="flex justify-between items-center px-2 py-1.5 rounded-md hover:bg-risk-high/[0.08] transition-colors text-left"
                  >
                    <span className="text-ink-dim text-xs font-mono">{email}</span>
                    <span className="bg-risk-high/15 border border-risk-high/30 text-risk-high text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
