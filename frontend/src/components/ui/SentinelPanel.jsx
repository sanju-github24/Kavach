import { useState } from 'react'
import { sentinelScan } from '../../api.js'
import { IconAlert, IconCheck, IconBolt } from './Icons'

// KAVACH Sentinel — the platform's 24/7 watch. The same alert engine that
// powers Early Warning is re-run on a Catalyst Cron schedule and delivered as
// a digest, so priority signals reach an officer instead of waiting to be
// discovered. This panel exposes a manual run plus e-mail delivery.
const SEV = {
  CRITICAL: { c: '#F1493F', bg: 'rgba(241,73,63,0.08)',  bd: 'rgba(241,73,63,0.30)' },
  HIGH:     { c: '#F0A23D', bg: 'rgba(240,162,61,0.08)', bd: 'rgba(240,162,61,0.30)' },
}

export default function SentinelPanel() {
  const [res, setRes]   = useState(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState(null)

  const run = async (notify) => {
    setBusy(true); setNote(null)
    try {
      const r = await sentinelScan({ notify, to: notify ? email.trim() : '' })
      setRes(r)
      if (notify) {
        setNote(r?.emailed
          ? { ok: true,  text: `Digest sent to ${email.trim()}` }
          : { ok: false, text: r?.emailError
              ? `Could not send: ${r.emailError}. Verify a sender address in the Catalyst console.`
              : 'Could not send the digest.' })
      }
    } catch {
      setNote({ ok: false, text: 'Scan failed — check the backend connection.' })
    }
    setBusy(false)
  }

  return (
    <div className="kv-card p-5 animate-fade-up">
      <div className="flex justify-between items-baseline mb-4 flex-wrap gap-2">
        <h2 className="kv-title flex items-center gap-2"><IconBolt className="w-3.5 h-3.5" /> KAVACH Sentinel</h2>
        <span className="text-[9px] text-ink-faint">
          {res ? `last scan ${new Date(res.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'runs on a Catalyst Cron schedule'}
        </span>
      </div>

      {res && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Priority alerts', value: res.priorityCount, color: '#F0A23D' },
            { label: 'Critical',        value: res.criticalCount, color: '#F1493F' },
            { label: 'Total signals',   value: res.totalAlerts,   color: '#FFFFFF' },
          ].map(k => (
            <div key={k.label} className="bg-base border border-base-border rounded-xl p-3">
              <p className="font-display font-bold text-2xl tabular" style={{ color: k.color }}>{k.value ?? 0}</p>
              <p className="text-[9px] text-ink-dim uppercase tracking-widest mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {res?.alerts?.length > 0 && (
        <div className="space-y-2 mb-4 max-h-56 overflow-y-auto pr-1">
          {res.alerts.map((a, i) => {
            const s = SEV[a.severity] || SEV.HIGH
            return (
              <div key={i} className="p-2.5 rounded-lg border" style={{ background: s.bg, borderColor: s.bd }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: s.c, border: `1px solid ${s.bd}` }}>{a.severity}</span>
                  <span className="text-[9px] text-ink-faint uppercase tracking-wider">{a.type}</span>
                </div>
                <p className="text-[11px] text-ink-dim leading-relaxed">{a.msg}</p>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={() => run(false)} disabled={busy}
          className="bg-accent text-base font-bold text-xs px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-40 transition">
          {busy ? 'Scanning…' : res ? 'Re-run scan' : 'Run scan now'}
        </button>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email"
          placeholder="officer@ksp.gov.in"
          className="flex-1 min-w-[180px] bg-base border border-base-border focus:border-white/50 rounded-lg px-3 py-2 text-[11px] text-white placeholder-ink-faint outline-none transition-colors" />
        <button onClick={() => run(true)} disabled={busy || !email.trim()}
          className="border border-base-border hover:border-white/40 text-ink-dim hover:text-white text-xs px-3 py-2 rounded-lg transition disabled:opacity-30">
          Email digest
        </button>
      </div>

      {note && (
        <p className={`text-[11px] mt-2.5 flex items-start gap-1.5 ${note.ok ? 'text-risk-low' : 'text-risk-high'}`}>
          <span className="flex-shrink-0 mt-0.5">{note.ok ? <IconCheck className="w-3 h-3" /> : <IconAlert className="w-3 h-3" />}</span>
          {note.text}
        </p>
      )}

      {!res && !busy && (
        <p className="text-[10px] text-ink-faint mt-3 leading-relaxed">
          Scans every district for anomaly spikes, recurring MO clusters and high-risk offenders,
          then delivers only what needs action.
        </p>
      )}
    </div>
  )
}
