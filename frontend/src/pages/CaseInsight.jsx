import { useState, useEffect } from 'react'
import { dataQuery, getAccusedPhotosBulk } from '../api.js'
import AccusedAvatar from '../components/ui/AccusedAvatar'
import ZiaTextPanel from '../components/ui/ZiaTextPanel'
import { PageHeader } from '../components/ui/Panel'

// Investigator decision support: look up a case, see its full investigation
// timeline (FIR → arrests → chargesheet) and the most similar past cases,
// ranked by an explainable weighted feature match (crime type, MO, district,
// time window, gravity).

const EVENT_COLOR = {
  'FIR Registered':        '#60A5FA',
  'Arrest / Surrender':    '#F0A23D',
  'Chargesheet Filed':     '#A78BFA',
  'Closed — False Case':   '#707070',
  'Closed — Undetected':   '#707070',
}

const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) } catch { return d } }

export default function CaseInsight() {
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [photos, setPhotos]   = useState({})

  const lookup = async (q = query) => {
    const needle = q.trim()
    if (!needle || loading) return
    setLoading(true); setError(null)
    try {
      const res = await dataQuery('case_insight', { query: needle })
      setData(res)
      if (res?.error) setError(res.error)
    } catch (e) {
      setError('Lookup failed — check backend connection.')
    }
    setLoading(false)
  }

  const c = data?.case

  // Bulk-fetch any attached photos for this case's accused in one call.
  useEffect(() => {
    const ids = c?.accused?.map(a => a.id) || []
    if (!ids.length) return
    getAccusedPhotosBulk(ids).then(d => setPhotos(d?.photos || {})).catch(() => {})
  }, [c?.fir_id])

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Case Insight & Decision Support"
        subtitle="Investigation timeline · Similar past cases · Explainable match scoring"
      />

      {/* Search */}
      <div className="flex gap-2 items-center bg-[#0A0A0A] border border-[#2E2E2E] focus-within:border-[#FFFFFF]/50 rounded-xl px-3 py-2 max-w-2xl transition">
        <span className="text-gray-600 text-xs flex-shrink-0">FIR / Crime No.</span>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="e.g. 0033/2023 or a case number fragment…"
          className="flex-1 bg-transparent outline-none text-sm text-white placeholder-gray-600 py-1"
        />
        <button onClick={() => lookup()} disabled={!query.trim() || loading}
          className="bg-[#FFFFFF] disabled:opacity-40 text-[#000000] font-bold px-4 py-1.5 rounded-lg text-xs hover:opacity-90 transition">
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {/* Not found → clickable suggestions */}
      {data?.notFound && (
        <div className="kv-card animate-fade-up p-5 max-w-2xl">
          <p className="text-gray-400 text-xs mb-3">No case matched that reference. Try one of these registered cases:</p>
          <div className="flex flex-wrap gap-2">
            {(data.suggestions || []).map((s, i) => (
              <button key={i} onClick={() => { setQuery(s.fir_number); lookup(s.fir_number) }}
                className="text-[10px] font-mono px-2.5 py-1.5 rounded-lg bg-[#000000] border border-[#2E2E2E] text-gray-300 hover:border-[#FFFFFF]/40 hover:text-white transition">
                {s.fir_number} <span className="text-gray-600">· {s.district} · {s.crime}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="py-20 text-center border border-[#2E2E2E] rounded-xl bg-[#0A0A0A] max-w-2xl">
          <p className="text-gray-500 text-sm mb-1">Enter a FIR / crime number to begin</p>
          <p className="text-gray-600 text-[11px]">You'll get the investigation timeline, linked accused &amp; victims,<br/>and the most similar past cases with match reasoning.</p>
        </div>
      )}

      {c && (
        <>
          {/* Case card */}
          <div className="kv-card animate-fade-up p-6" style={{ borderLeft: '3px solid #60A5FA' }}>
            <div className="flex justify-between items-start flex-wrap gap-3">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Case File</p>
                <h2 className="text-white text-xl font-black">{c.fir_number}</h2>
                <p className="text-gray-400 text-xs mt-1">{c.station}, {c.district} · Filed {fmtDate(c.date_filed)}</p>
              </div>
              <div className="text-right">
                <p className="text-white font-bold text-sm">{c.crime}</p>
                <p className="text-gray-500 text-[10px]">{c.crime_head}{c.gravity ? ` · ${c.gravity}` : ''}</p>
                <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded border border-[#2E2E2E] text-[#60A5FA]">{c.status}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5 pt-4 border-t border-[#2E2E2E]/50 text-[11px]">
              <div>
                <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-1">Modus Operandi</p>
                <p className="text-gray-200 leading-relaxed">{c.mo || 'Not recorded'}</p>
                {c.time_window !== 'Unknown' && <p className="text-amber-400/80 text-[10px] mt-1">⏱ {c.time_window}</p>}
              </div>
              <div>
                <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-1">Victims ({c.victims?.length || 0})</p>
                {(c.victims || []).map((v, i) => <p key={i} className="text-gray-200">{v.name} <span className="text-gray-600">{v.age ? `(${v.age})` : ''}</span></p>)}
                {!c.victims?.length && <p className="text-gray-600">None on record</p>}
              </div>
            </div>

            {/* Accused — pulled out to its own row with bigger, clearly
                visible avatars rather than tucked into the narrow grid above */}
            <div className="mt-5 pt-4 border-t border-[#2E2E2E]/50">
              <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-3">Accused ({c.accused?.length || 0})</p>
              {c.accused?.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {c.accused.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 bg-[#000000] border border-[#2E2E2E] rounded-xl p-3">
                      <AccusedAvatar
                        accusedId={a.id} name={a.name} photoUrl={photos[a.id]} size={56} borderColor="#60A5FA" editable
                        onPhotoChange={(url) => setPhotos(p => ({ ...p, [a.id]: url }))}
                      />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-bold truncate">{a.name}</p>
                        <p className="text-gray-500 text-[11px] font-mono">{a.id}{a.age ? ` · ${a.age}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-[11px]">None on record</p>
              )}
            </div>
          </div>

          {/* Zia Text Intelligence — NER / keywords / tone on the narrative */}
          <ZiaTextPanel narrative={c.narrative || c.mo} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Investigation timeline */}
            <div className="kv-card animate-fade-up p-5">
              <h2 className="kv-title mb-4">Investigation Timeline</h2>
              {data.timeline?.length ? (
                <div className="space-y-0">
                  {data.timeline.map((t, i) => (
                    <div key={i} className="flex gap-4 items-start">
                      <div className="flex flex-col items-center">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 border-2 border-[#000000]"
                          style={{ background: EVENT_COLOR[t.event] || '#707070', boxShadow: `0 0 0 1px ${EVENT_COLOR[t.event] || '#707070'}` }} />
                        {i < data.timeline.length - 1 && <div className="w-px bg-[#2E2E2E] mt-1" style={{ minHeight: 34 }} />}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex justify-between items-baseline gap-3 flex-wrap">
                          <span className="text-xs font-bold" style={{ color: EVENT_COLOR[t.event] || '#FAFAFA' }}>{t.event}</span>
                          <span className="text-gray-600 text-[10px] tabular-nums">{fmtDate(t.date)}</span>
                        </div>
                        <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">{t.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-600 text-xs py-8 text-center">No dated events on record for this case.</p>}
            </div>

            {/* Similar past cases */}
            <div className="kv-card animate-fade-up p-5">
              <div className="flex justify-between items-baseline mb-4 flex-wrap gap-2">
                <h2 className="kv-title">Similar Past Cases</h2>
                <span className="text-[9px] text-gray-600">weighted match: crime 35 · MO 30 · district 15 · time 10 · gravity 10</span>
              </div>
              {data.similar?.length ? (
                <div className="space-y-3">
                  {data.similar.map((s, i) => (
                    <div key={i} className="p-3.5 rounded-xl bg-[#000000] border border-[#2E2E2E] hover:border-[#FFFFFF]/25 transition">
                      <div className="flex justify-between items-start gap-3 mb-1.5">
                        <button onClick={() => { setQuery(s.fir_number); lookup(s.fir_number) }}
                          className="text-[#60A5FA] text-xs font-bold font-mono hover:underline text-left">
                          {s.fir_number}
                        </button>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded tabular-nums flex-shrink-0 ${
                          s.score >= 80 ? 'bg-red-950/50 text-red-400 border border-red-800/40'
                          : s.score >= 60 ? 'bg-amber-950/50 text-amber-400 border border-amber-800/40'
                          : 'bg-[#0A0A0A] text-gray-400 border border-[#2E2E2E]'}`}>
                          {s.score}% match
                        </span>
                      </div>
                      <p className="text-gray-400 text-[10px] mb-1.5">{s.crime} · {s.district} · {s.status} · {fmtDate(s.date)}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {s.reasons.map((r, ri) => (
                          <span key={ri} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/30 border border-emerald-800/30 text-emerald-400">✓ {r}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-600 text-xs py-8 text-center">No sufficiently similar past cases found (threshold: 45% match).</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
