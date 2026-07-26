import { useState, useEffect } from 'react'
import { dataQuery, getAccusedPhotosBulk } from '../api.js'
import AccusedAvatar from '../components/ui/AccusedAvatar'
import { PageHeader, KpiCard } from '../components/ui/Panel'
import ZiaRiskPredict from '../components/ui/ZiaRiskPredict'

// No hardcoded profiles — every offender comes from the live `profiler` action.

const STATUS_COLOR = {
  'Open':'#F0A23D', 'Under Investigation':'#60A5FA',
  'Charge Sheet Filed':'#A78BFA', 'Closed':'#2CB67D', 'Pending Trial':'#F0A23D',
}

function riskMeta(score) {
  const s = Number(score)
  if (s >= 80) return { color:'#F1493F', label:'HIGH',   bg:'rgba(239,68,68,0.08)',   border:'rgba(239,68,68,0.25)'   }
  if (s >= 60) return { color:'#F0A23D', label:'MEDIUM', bg:'rgba(245,158,11,0.08)',  border:'rgba(245,158,11,0.25)'  }
  return             { color:'#2CB67D', label:'LOW',    bg:'rgba(34,197,94,0.08)',   border:'rgba(34,197,94,0.25)'   }
}

export default function Profiler() {
  const [profiles,    setProfiles]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState(null)
  const [search,      setSearch]      = useState('')
  const [filterRisk,  setFilterRisk]  = useState('All')
  const [view,        setView]        = useState('profiles') // 'profiles' | 'mo'
  const [moData,      setMoData]      = useState(null)

  useEffect(() => {
    dataQuery('profiler')
      .then(d  => { setProfiles(d?.profiles || []); setLoading(false) })
      .catch(() => { setProfiles([]); setLoading(false) })
    dataQuery('mo_patterns')
      .then(d => { if (d?.patterns) setMoData(d) })
      .catch(() => {})
  }, [])

  const filtered = profiles.filter(p => {
    const q  = search.toLowerCase()
    const ok = !q ||
      p.name?.toLowerCase().includes(q) ||
      p.accused_id?.toLowerCase().includes(q) ||
      p.district?.toLowerCase().includes(q) ||
      p.primary_crime?.toLowerCase().includes(q)
    const rm = riskMeta(p.risk_score)
    return ok && (filterRisk === 'All' || rm.label === filterRisk)
  })

  if (selected) return <ProfileDetail p={selected} onBack={() => setSelected(null)} />

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      {/* Header */}
      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Offender Profiler"
        subtitle={loading ? 'Loading profiles from Data Store…' : `${profiles.length} profiles · ${profiles.filter(p=>Number(p.is_repeat_offender)===1).length} repeat offenders`}
        right={
        <div className="flex gap-2 flex-wrap">
          <div className="flex bg-[#0A0A0A] border border-[#2E2E2E] rounded-lg overflow-hidden text-[11px]">
            {[['profiles','Profiles'],['mo','MO Patterns']].map(([id,label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-3 py-1.5 font-bold uppercase transition ${view===id ? 'bg-[#FFFFFF] text-[#000000]' : 'text-gray-500 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, ID, district, crime…"
            className="bg-[#0A0A0A] border border-[#2E2E2E] rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 outline-none focus:border-[#FFFFFF] w-52 transition"
          />
          {['All','HIGH','MEDIUM','LOW'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)}
              className={`px-3 py-1.5 rounded text-[11px] font-bold uppercase transition-all border ${
                filterRisk === r
                  ? 'bg-[#FFFFFF] text-[#000000] border-[#FFFFFF]'
                  : 'text-gray-500 border-[#2E2E2E] hover:text-[#FFFFFF] hover:border-[#FFFFFF]/40'
              }`}>{r}</button>
          ))}
        </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'Total Profiles',   value:profiles.length,                                              color:'#FFFFFF' },
          { label:'High Risk',        value:profiles.filter(p=>Number(p.risk_score)>=80).length,          color:'#F1493F' },
          { label:'Repeat Offenders', value:profiles.filter(p=>Number(p.is_repeat_offender)===1).length,  color:'#F0A23D' },
          { label:'Avg Risk Score',   value:profiles.length ? Math.round(profiles.reduce((s,p)=>s+Number(p.risk_score||0),0)/profiles.length) : 0, color:'#A78BFA' },
        ].map((s, i) => (
          <KpiCard key={s.label} label={s.label} value={s.value} color={s.color} delay={i * 40} />
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-4 border-t-transparent border-[#FFFFFF] rounded-full animate-spin" />
          <p className="text-xs text-gray-500">Loading profiles…</p>
        </div>
      )}

      {/* Recurring MO pattern analysis — clusters of cases sharing an
          identical modus operandi narrative, with where/when they operate */}
      {!loading && view === 'mo' && (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <p className="text-[11px] text-gray-500">
              {moData?.patterns?.length
                ? `${moData.patterns.length} recurring MO signatures across ${moData.totalWithMO} cases with recorded MO (of ${moData.totalCases} total)`
                : 'Loading MO pattern clusters…'}
            </p>
            <span className="text-[9px] text-gray-600 uppercase tracking-widest">Behavioral analysis · Inv_OccuranceTime narratives</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(moData?.patterns || []).slice(0, 12).map((p, i) => (
              <div key={i} className="kv-card animate-fade-up p-5 hover:border-[#FFFFFF]/25 transition">
                <div className="flex justify-between items-start gap-3 mb-3">
                  <h3 className="text-white text-sm font-black leading-snug">{p.mo}</h3>
                  <span className="text-[10px] font-black px-2 py-1 rounded bg-amber-950/40 border border-amber-800/40 text-amber-400 flex-shrink-0 tabular-nums">
                    {p.count} cases
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] mb-3">
                  <div>
                    <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-0.5">Concentrated in</p>
                    <p className="text-gray-200 font-bold">{p.topDistricts.map(d => `${d.name} (${d.count})`).join(', ')}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-0.5">Peak window</p>
                    <p className="text-amber-400 font-bold">{p.peakBand}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-0.5">Crime types</p>
                    <p className="text-gray-200">{p.topCrimes.map(c => c.name).join(' · ')}</p>
                  </div>
                </div>
                {p.sampleCases?.length > 0 && (
                  <div className="border-t border-[#2E2E2E]/50 pt-2.5">
                    <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-1">Linked cases</p>
                    <div className="flex flex-wrap gap-1.5">
                      {p.sampleCases.map((c, ci) => (
                        <span key={ci} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#000000] border border-[#2E2E2E] text-gray-400" title={`${c.district} · ${c.date || ''}`}>
                          {c.fir_number}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {moData && !moData.patterns?.length && (
            <div className="py-16 text-center text-gray-600 text-xs border border-[#2E2E2E] rounded-xl bg-[#0A0A0A]">
              No recurring MO patterns found in the current dataset.
            </div>
          )}
        </div>
      )}

      {/* Profile grid */}
      {!loading && view === 'profiles' && (
        <>
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-gray-600 text-xs border border-[#2E2E2E] rounded-xl bg-[#0A0A0A]">
              No profiles match your search or filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(p => {
                const rm = riskMeta(p.risk_score)
                return (
                  <div key={p.accused_id} onClick={() => setSelected(p)}
                    className="kv-card animate-fade-up overflow-hidden cursor-pointer group hover:border-[#FFFFFF]/30 hover:shadow-lg hover:shadow-black/30 hover:-translate-y-0.5 transition-all duration-200">

                    {/* Risk accent */}
                    <div className="h-0.5 w-full" style={{ background:`linear-gradient(90deg, ${rm.color}, transparent)` }} />

                    <div className="px-5 py-4 flex justify-between items-start">
                      <div>
                        <h3 className="text-white font-black text-sm group-hover:text-[#FFFFFF] transition-colors">{p.name}</h3>
                        <p className="text-[#FFFFFF]/60 text-[10px] font-mono mt-0.5">{p.accused_id}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black tabular-nums" style={{ color:rm.color }}>{p.risk_score}</div>
                        <div className="text-[9px] font-bold uppercase" style={{ color:rm.color }}>{rm.label}</div>
                      </div>
                    </div>

                    {/* Risk bar */}
                    <div className="px-5 pb-3">
                      <div className="w-full bg-[#000000] h-1 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width:`${p.risk_score}%`, background:rm.color }} />
                      </div>
                    </div>

                    {/* Info grid */}
                    <div className="px-5 pb-4 pt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#2E2E2E]/50">
                      {[
                        { label:'Crime',    value:p.primary_crime },
                        { label:'District', value:p.district },
                        { label:'Age',      value:`${p.age} · ${p.gender}` },
                        { label:'Cases',    value:`${p.fir_count||'?'} FIRs` },
                      ].map(f => (
                        <div key={f.label}>
                          <p className="text-gray-600 text-[9px] uppercase tracking-wider">{f.label}</p>
                          <p className="text-gray-200 text-[11px] font-bold truncate">{f.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="px-5 py-2.5 bg-[#000000] border-t border-[#2E2E2E]/50 flex justify-between items-center">
                      <div className="flex items-center gap-1.5">
                        {Number(p.is_repeat_offender) === 1 && (
                          <span className="text-[9px] bg-red-950 text-red-400 border border-red-800/60 px-1.5 py-0.5 rounded font-bold">REPEAT</span>
                        )}
                        <span className="text-[9px] text-gray-600 uppercase">{p.economic_status} income</span>
                      </div>
                      <span className="text-[#FFFFFF]/60 text-[10px] group-hover:text-[#FFFFFF] transition font-bold">View dossier →</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ProfileDetail({ p, onBack }) {
  const rm = riskMeta(p.risk_score)
  const [photo, setPhoto] = useState(null)

  useEffect(() => {
    getAccusedPhotosBulk([p.accused_id]).then(d => setPhoto(d?.photos?.[p.accused_id] || null)).catch(() => {})
  }, [p.accused_id])

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full font-mono space-y-5">

      <button onClick={onBack}
        className="text-gray-500 hover:text-[#FFFFFF] text-xs flex items-center gap-1 transition">
        ← Back to Profiler
      </button>

      {/* Identity card */}
      <div className="kv-card animate-fade-up p-6 relative overflow-hidden"
        style={{ borderLeft:`3px solid ${rm.color}` }}>
        <div className="absolute top-0 right-0 w-64 h-64 opacity-5 rounded-full"
          style={{ background:`radial-gradient(circle, ${rm.color}, transparent)`, transform:'translate(40px,-40px)' }} />
        <div className="flex justify-between items-start relative">
          <div className="flex items-center gap-5">
            <AccusedAvatar
              accusedId={p.accused_id} name={p.name} photoUrl={photo} size={96} borderColor={rm.color} editable
              onPhotoChange={setPhoto}
            />
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Accused Dossier</p>
              <h1 className="text-white text-2xl font-black">{p.name}</h1>
              <p className="text-[#FFFFFF]/70 text-xs font-mono mt-1">{p.accused_id} · {p.district}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-5xl font-black tabular-nums" style={{ color:rm.color }}>{p.risk_score}</div>
            <div className="text-xs font-bold uppercase mt-1" style={{ color:rm.color }}>{rm.label} RISK</div>
            {Number(p.is_repeat_offender) === 1 && (
              <span className="inline-block mt-2 text-[9px] bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded font-bold">
                REPEAT OFFENDER
              </span>
            )}
          </div>
        </div>
        <div className="mt-5 relative">
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Risk Score</span><span className="tabular-nums">{p.risk_score}/100</span>
          </div>
          <div className="w-full bg-[#000000] h-1.5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width:`${p.risk_score}%`, background:rm.color }} />
          </div>
        </div>
      </div>

      {/* Zia AutoML risk prediction */}
      <ZiaRiskPredict p={p} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

        {/* Personal profile */}
        <div className="kv-card animate-fade-up p-5">
          <h2 className="text-[10px] font-bold text-[#FFFFFF] uppercase tracking-widest mb-4">Personal Profile</h2>
          <div className="space-y-3">
            {[
              { label:'Age',             value:p.age },
              { label:'Gender',          value:p.gender },
              { label:'District',        value:p.district },
              { label:'Occupation',      value:p.occupation||'Unknown' },
              { label:'Education',       value:p.education||'Unknown' },
              { label:'Economic Status', value:p.economic_status||'Unknown' },
            ].map(f => (
              <div key={f.label} className="flex justify-between border-b border-[#2E2E2E]/30 pb-2">
                <span className="text-gray-500 text-[10px] uppercase tracking-wider">{f.label}</span>
                <span className="text-white text-[11px] font-bold">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Criminal profile */}
        <div className="kv-card animate-fade-up p-5">
          <h2 className="text-[10px] font-bold text-[#FFFFFF] uppercase tracking-widest mb-4">Criminal Profile</h2>
          <div className="space-y-3 mb-5">
            {[
              { label:'Primary Crime', value:p.primary_crime },
              { label:'Total FIRs',    value:p.fir_count||'?' },
              { label:'Repeat',        value:Number(p.is_repeat_offender) ? 'Yes' : 'No' },
            ].map(f => (
              <div key={f.label} className="flex justify-between border-b border-[#2E2E2E]/30 pb-2">
                <span className="text-gray-500 text-[10px] uppercase tracking-wider">{f.label}</span>
                <span className="text-white text-[11px] font-bold">{f.value}</span>
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-2">Modus Operandi</p>
          <p className="text-gray-300 text-[11px] leading-relaxed bg-[#000000] rounded-lg p-3 border border-[#2E2E2E]/50">
            {p.modus_operandi||'Not recorded'}
          </p>
        </div>

        {/* Investigative leads */}
        <div className="kv-card animate-fade-up p-5">
          <h2 className="text-[10px] font-bold text-[#FFFFFF] uppercase tracking-widest mb-4">Investigative Leads</h2>
          <div className="space-y-3">
            {[
              Number(p.risk_score) >= 80   && 'Proactive surveillance recommended — oppose bail on re-arrest',
              Number(p.is_repeat_offender) && 'File habitual offender docs under CrPC Section 110',
              p.primary_crime === 'Narcotics' && 'Coordinate with NCB for NDPS network mapping',
              p.primary_crime === 'Fraud'     && 'Forward to CID Economic Offences Wing',
              p.primary_crime === 'Robbery'   && 'Cross-check CCTNS for inter-district MO matches',
              'Run CCTNS check for inter-state links',
              'Verify associates via Relationships table',
            ].filter(Boolean).slice(0,5).map((rec, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-[#FFFFFF] text-[10px] flex-shrink-0 font-bold">{i+1}.</span>
                <p className="text-gray-300 text-[10px] leading-relaxed">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FIR timeline */}
      {p.firs?.length > 0 && (
        <div className="kv-card animate-fade-up p-5">
          <h2 className="text-[10px] font-bold text-[#FFFFFF] uppercase tracking-widest mb-4">Case Timeline</h2>
          <div className="space-y-3">
            {p.firs.map((fir, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                    style={{ background:STATUS_COLOR[fir.status]||'#707070' }} />
                  {i < p.firs.length-1 && <div className="w-px flex-1 bg-[#2E2E2E]/40 mt-1 min-h-[20px]" />}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex justify-between items-start">
                    <span className="text-[#FFFFFF] text-xs font-mono font-bold">{fir.number}</span>
                    <span className="text-gray-600 text-[10px] font-mono">{fir.date}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-gray-300 text-[11px]">{fir.crime}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                      style={{ color:STATUS_COLOR[fir.status]||'#707070', background:(STATUS_COLOR[fir.status]||'#707070')+'18' }}>
                      {fir.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}