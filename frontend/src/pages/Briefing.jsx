import React, { useState, useEffect } from 'react'
import { createReportDoc, finalizeDoc, sectionHeading, markdownParagraph } from '../utils/pdfKit.js'
import { buildReportHtml, serverPdf } from '../utils/reportHtml.js'
import { generateBriefing, fetchAnalytics, listBriefings, getBriefing, deleteBriefing } from '../api.js'
import { useAuth } from '../contexts/AuthContext'
import { IconSpeaker, IconSpeakerOff, IconTrash, IconTimeline, IconDownload } from '../components/ui/Icons'
import { PageHeader } from '../components/ui/Panel'
import SpeakButton from '../components/ui/SpeakButton'

// One-click AI Intelligence Briefing: pulls together everything already
// computed elsewhere (live alerts, anomalies, recurring MO, forecast, top
// repeat offenders) into a single narrative document — the same "why this
// answer" transparency as Chat, but as a standalone briefing artifact.

function renderMarkdown(text) {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean)
  const blocks = []
  let bulletBuffer = []
  const flush = () => {
    if (bulletBuffer.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-none space-y-1.5 my-2">
          {bulletBuffer.map((l, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-300">
              <span className="text-white flex-shrink-0 mt-0.5">-</span>
              <span>{inline(l.replace(/^[-*]\s*/, ''), `b${i}`)}</span>
            </li>
          ))}
        </ul>
      )
      bulletBuffer = []
    }
  }
  function inline(line, key) {
    const parts = line.split(/(\*\*.*?\*\*)/g)
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={`${key}-${i}`} className="text-white font-bold">{p.slice(2, -2)}</strong>
        : <React.Fragment key={`${key}-${i}`}>{p}</React.Fragment>
    )
  }
  lines.forEach((line, idx) => {
    if (/^##\s+/.test(line)) {
      flush()
      blocks.push(<h3 key={idx} className="text-white text-sm font-black uppercase tracking-widest mt-6 mb-2 pb-2 border-b border-[#2E2E2E] first:mt-0">{line.replace(/^##\s+/, '')}</h3>)
    } else if (/^[-*]\s+/.test(line)) {
      bulletBuffer.push(line)
    } else {
      flush()
      blocks.push(<p key={idx} className="text-[13px] leading-relaxed text-gray-300 my-1.5">{inline(line, idx)}</p>)
    }
  })
  flush()
  return blocks
}

function ttsClean(text) {
  return (text || '').replace(/##\s*/g, '').replace(/\*\*/g, '').replace(/^[-*]\s*/gm, '').replace(/\s+/g, ' ').trim()
}

const SCOPE_ALL = 'Statewide'

function relativeTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' })
}

export default function Briefing() {
  const { user } = useAuth()
  const [districts, setDistricts] = useState([])
  const [scope, setScope]         = useState(SCOPE_ALL)
  const [loading, setLoading]     = useState(false)
  const [data, setData]           = useState(null)
  const [error, setError]         = useState(null)
  const [speaking, setSpeaking]   = useState(false)
  const [history, setHistory]     = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics().then(a => { if (a?.districts?.length) setDistricts(a.districts.map(d => d.name)) }).catch(() => {})
  }, [])

  const refreshHistory = () => {
    if (!user?.id) { setHistoryLoading(false); return }
    listBriefings(user.id).then(d => setHistory(d?.briefings || [])).catch(() => {}).finally(() => setHistoryLoading(false))
  }
  useEffect(() => { refreshHistory() }, [user?.id])

  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  const run = async () => {
    setLoading(true); setError(null); setData(null)
    window.speechSynthesis?.cancel(); setSpeaking(false)
    try {
      const res = await generateBriefing(scope, { id: user?.id, role: user?.role, name: user?.firstName })
      if (res?.error) setError(res.error)
      else {
        setData(res)
        if (res.briefingId) {
          setHistory(prev => [
            { briefing_id: res.briefingId, scope: res.scope, generated_by: res.generatedBy, confidence: res.confidence, created_at: res.generatedAt },
            ...prev,
          ])
        }
      }
    } catch (e) {
      setError('Briefing generation failed — check backend connection.')
    }
    setLoading(false)
  }

  const loadPast = async (briefingId) => {
    setLoading(true); setError(null)
    window.speechSynthesis?.cancel(); setSpeaking(false)
    try {
      const res = await getBriefing(briefingId)
      if (res?.error) setError(res.error)
      else { setData({ ...res, briefingId }); setScope(res.scope || SCOPE_ALL) }
    } catch (e) {
      setError('Could not load that briefing.')
    }
    setLoading(false)
    setHistoryOpen(false)
  }

  const removePast = async (briefingId, e) => {
    e.stopPropagation()
    setHistory(prev => prev.filter(h => h.briefing_id !== briefingId))
    if (data?.briefingId === briefingId) setData(null)
    try { await deleteBriefing(briefingId) } catch {}
  }

  const speak = () => {
    const synth = window.speechSynthesis
    if (!synth) { alert('Voice output requires Chrome, Edge, or Safari.'); return }
    if (speaking) { synth.cancel(); setSpeaking(false); return }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(ttsClean(data.briefing).slice(0, 3000))
    u.lang = 'en-IN'; u.rate = 1.02
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    synth.speak(u)
  }

  // Primary: server-side SmartBrowz render; local jsPDF fallback.
  const exportPDF = () => {
    const subtitle = `Scope: ${data.scope}`
    const meta = `Generated ${new Date(data.generatedAt).toLocaleString('en-IN')}`
    // Split the briefing markdown into sections at each "## heading".
    const sections = []
    let cur = null
    ;(data.briefing || '').split('\n').forEach(line => {
      if (/^##\s+/.test(line)) { cur = { heading: line.replace(/^##\s+/, ''), paragraphs: [] }; sections.push(cur) }
      else if (line.trim()) { if (!cur) { cur = { heading: 'Briefing', paragraphs: [] }; sections.push(cur) } cur.paragraphs.push(line.trim()) }
    })
    const html = buildReportHtml({ title: 'AI Intelligence Briefing', subtitle, meta, sections })
    return serverPdf(html, `KAVACH_Briefing_${data.scope.replace(/\s+/g, '_')}_${Date.now()}.pdf`, exportPDFLocal)
  }

  const exportPDFLocal = () => {
    const headerInfo = {
      title: 'AI Intelligence Briefing',
      subtitle: `Scope: ${data.scope}`,
      meta: `Generated ${new Date(data.generatedAt).toLocaleString('en-IN')}`,
    }
    const doc = createReportDoc(headerInfo)
    let y = 40
    const lines = (data.briefing || '').split('\n').filter(Boolean)
    let paraBuf = []
    const flush = () => {
      if (paraBuf.length) { y = markdownParagraph(doc, paraBuf.join('\n'), y); paraBuf = [] }
    }
    lines.forEach(line => {
      if (/^##\s+/.test(line)) {
        flush()
        y = sectionHeading(doc, line.replace(/^##\s+/, ''), y)
      } else {
        paraBuf.push(line)
      }
    })
    flush()
    finalizeDoc(doc, headerInfo)
    doc.save(`KAVACH_Briefing_${data.scope.replace(/\s+/g, '_')}_${Date.now()}.pdf`)
  }

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="AI Intelligence Briefing"
        subtitle="One-click narrative combining live alerts, anomalies, recurring MO, and forecast into a single briefing"
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 kv-card animate-fade-up p-4 relative">
        <span className="text-gray-500 text-xs">Scope</span>
        <select value={scope} onChange={e => setScope(e.target.value)}
          className="bg-[#000000] border border-[#2E2E2E] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#FFFFFF] min-w-[180px]">
          <option value={SCOPE_ALL}>Statewide — all districts</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={run} disabled={loading}
          className="bg-[#FFFFFF] disabled:opacity-40 text-[#000000] font-bold px-4 py-1.5 rounded-lg text-xs hover:opacity-90 transition">
          {loading ? 'Generating…' : data ? 'Regenerate briefing' : 'Generate briefing'}
        </button>

        <div className="relative">
          <button onClick={() => setHistoryOpen(o => !o)}
            className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs transition ${historyOpen ? 'bg-[#FFFFFF]/10 border-[#FFFFFF]/40 text-white' : 'bg-[#000000] border-[#2E2E2E] text-gray-300 hover:text-white'}`}>
            <IconTimeline className="w-3.5 h-3.5" /> History {history.length > 0 && `(${history.length})`}
          </button>
          {historyOpen && (
            <div className="absolute z-20 top-full mt-2 left-0 w-80 max-h-96 overflow-y-auto rounded-xl border border-white/10 animate-fade-up"
              style={{ backgroundColor: '#1C1C1E', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)' }}>
              {historyLoading && <p className="text-gray-600 text-xs p-4 text-center">Loading history…</p>}
              {!historyLoading && history.length === 0 && (
                <p className="text-gray-600 text-xs p-4 text-center leading-relaxed">No past briefings yet — generated briefings are saved here automatically.</p>
              )}
              {history.map(h => (
                <div key={h.briefing_id} onClick={() => loadPast(h.briefing_id)}
                  className="group flex items-start gap-2 px-3 py-2.5 border-b border-[#2E2E2E]/60 last:border-0 hover:bg-[#FFFFFF]/[0.04] cursor-pointer transition">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-xs font-bold truncate">{h.scope}</p>
                    <p className="text-gray-500 text-[10px]">{relativeTime(h.created_at)} · {h.generated_by === 'rag' ? 'AI-drafted' : 'Template'} · {h.confidence}%</p>
                  </div>
                  <button onClick={(e) => removePast(h.briefing_id, e)} title="Delete"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-risk-critical flex-shrink-0 mt-0.5">
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {data && (
          <div className="flex gap-2 ml-auto">
            <div className="flex items-center bg-[#000000] border border-[#2E2E2E] px-3 py-1.5 rounded-lg">
              <SpeakButton text={ttsClean(data.briefing)} label="Read aloud" />
            </div>
            <button onClick={exportPDF} className="flex items-center gap-1.5 bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/40 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 transition">
              <IconDownload className="w-3 h-3" /> Export PDF
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-4 border-t-transparent border-[#FFFFFF] rounded-full animate-spin" />
          <p className="text-xs text-gray-500">Assembling live signals and drafting briefing…</p>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="py-20 text-center border border-[#2E2E2E] rounded-xl bg-[#0A0A0A]">
          <p className="text-gray-500 text-sm mb-1">Select a scope and click "Generate briefing"</p>
          <p className="text-gray-600 text-[11px]">Produces a Situation Overview, Emerging Threats, Repeat Offender Watch,<br/>Recurring MO, and Recommended Actions — grounded in live case data.</p>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Narrative */}
          <div className="lg:col-span-2 kv-card animate-fade-up p-6">
            <div className="flex justify-between items-center mb-1 flex-wrap gap-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest">{data.scope} · {new Date(data.generatedAt).toLocaleString('en-IN')}</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                data.generatedBy === 'rag'
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40'
                  : 'text-amber-400 bg-amber-950/40 border-amber-800/40'}`}>
                {data.generatedBy === 'rag' ? 'AI-DRAFTED (QuickML RAG)' : 'LIVE DATA TEMPLATE'} · {data.confidence}% confidence
              </span>
            </div>
            <div>{renderMarkdown(data.briefing)}</div>
            <SpeakButton text={ttsClean(data.briefing)} label="Listen to briefing (Catalyst Zia)" className="mt-4 pt-3 border-t border-base-border block" />
          </div>

          {/* Fact panel — same source data the narrative was grounded in */}
          <div className="space-y-4">
            <div className="kv-card animate-fade-up p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Case Snapshot</p>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <Stat label="Total cases" value={data.stats.totalCases} />
                <Stat label="Open" value={data.stats.open} />
                <Stat label="Charge-sheeted" value={`${data.stats.chargesheetRate}%`} />
                <Stat label="Repeat offenders" value={data.stats.repeatOffenders} />
              </div>
            </div>

            {data.anomalies?.length > 0 && (
              <div className="kv-card animate-fade-up p-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Anomalies cited</p>
                {data.anomalies.slice(0, 4).map((a, i) => (
                  <p key={i} className="text-[11px] text-gray-400 py-1 border-b border-[#2E2E2E]/40 last:border-0">
                    <span className="text-white font-bold">{a.district}</span> · z={a.zscore} · {a.month}
                  </p>
                ))}
              </div>
            )}

            {data.topOffenders?.length > 0 && (
              <div className="kv-card animate-fade-up p-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Offenders cited</p>
                {data.topOffenders.slice(0, 4).map((p, i) => (
                  <p key={i} className="text-[11px] text-gray-400 py-1 border-b border-[#2E2E2E]/40 last:border-0">
                    <span className="text-white font-bold">{p.name}</span> ({p.accused_id}) · risk {p.risk_score}
                  </p>
                ))}
              </div>
            )}

            {data.forecast && (
              <div className="kv-card animate-fade-up p-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Forecast model</p>
                <p className="text-[11px] text-gray-400">{data.forecast.method}</p>
                <p className="text-[11px] text-gray-400 mt-1">MAPE: <span className="text-white font-bold">{data.forecast.mape ?? '—'}%</span></p>
                <p className="text-[11px] text-gray-400 mt-1">Next months: <span className="text-amber-400 font-bold">{data.forecast.nextMonths?.join(' · ')}</span></p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-white text-lg font-black tabular-nums">{value}</p>
      <p className="text-gray-600 text-[9px] uppercase tracking-wider">{label}</p>
    </div>
  )
}
