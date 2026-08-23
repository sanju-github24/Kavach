import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ocrIntake, faceMatch, evidenceAnalyze } from '../api.js'
import { PageHeader, Callout } from '../components/ui/Panel'
import { IconAlert, IconCheck, IconSparkle, IconArrowUpRight } from '../components/ui/Icons'

// KAVACH Visual Intelligence — Catalyst Zia image services applied to police
// work. Every tab is built so its output feeds the analytics platform rather
// than ending as a standalone tool:
//   FIR Intake   scanned paper FIR  -> structured case fields (analysable)
//   Face Match   probe photo        -> ranked accused-gallery hits
//   Evidence     scene photo        -> object tags (a new chartable dimension)

const TABS = [
  { id: 'ocr',      label: 'FIR Intake',        hint: 'Scan a paper FIR into structured data' },
  { id: 'face',     label: 'Face Match',        hint: 'Match a photo against the accused gallery' },
  { id: 'evidence', label: 'Evidence Analysis', hint: 'Tag objects in a crime-scene photo' },
]

// The serverless request body caps at ~100KB, and a base64 image inflates by
// ~33%, so an A4 scan must be compressed to fit. Documents survive aggressive
// compression well: we step down resolution/quality (and drop to greyscale
// with a slight contrast lift, which also helps OCR) until the payload fits.
const MAX_B64 = 88000

const STEPS = [
  { dim: 1600, q: 0.72 }, { dim: 1400, q: 0.65 }, { dim: 1200, q: 0.58 },
  { dim: 1100, q: 0.52 }, { dim: 1000, q: 0.48 }, { dim: 900,  q: 0.42 },
  { dim: 800,  q: 0.38 },
]

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a readable image'))
      img.onload = () => {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        let out = null
        for (const { dim, q } of STEPS) {
          const scale = Math.min(1, dim / Math.max(img.width, img.height))
          c.width = Math.round(img.width * scale)
          c.height = Math.round(img.height * scale)
          ctx.filter = 'grayscale(1) contrast(1.15)'
          ctx.drawImage(img, 0, 0, c.width, c.height)
          out = c.toDataURL('image/jpeg', q)
          if (out.length <= MAX_B64) break
        }
        if (!out || out.length > MAX_B64) {
          reject(new Error('That image is too large to process even after compression — try cropping to just the FIR page.'))
          return
        }
        resolve(out)
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function ImageDrop({ value, onPick, label, disabled }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  const handle = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    try { onPick(await fileToBase64(file), null) }
    catch (e) { onPick(null, e.message) }
  }, [onPick])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]) }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`kv-card cursor-pointer transition-colors overflow-hidden ${over ? 'border-white/50' : 'kv-card-hover'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => handle(e.target.files?.[0])} />
      {value ? (
        <div className="relative">
          <img src={value} alt="upload preview" className="w-full max-h-[300px] object-contain bg-black" />
          <div className="px-4 py-2 border-t border-base-border text-[10px] text-ink-faint">
            Click to replace this image
          </div>
        </div>
      ) : (
        <div className="py-14 px-6 text-center">
          <div className="w-11 h-11 mx-auto mb-3 rounded-xl bg-base-raised border border-base-border flex items-center justify-center text-ink-dim">
            <IconSparkle className="w-5 h-5" />
          </div>
          <p className="text-white text-sm font-semibold mb-1">{label}</p>
          <p className="text-ink-faint text-[11px]">Drag an image here, or click to browse</p>
        </div>
      )}
    </div>
  )
}

function RunButton({ onClick, busy, disabled, children }) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className="w-full bg-accent text-base font-bold text-sm py-2.5 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2">
      {busy ? <><span className="w-3.5 h-3.5 border-2 border-base/40 border-t-base rounded-full animate-spin" />Analysing…</> : children}
    </button>
  )
}

function ConfidenceBar({ value, color = '#2CB67D' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="w-full bg-base h-1.5 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${v}%`, background: color }} />
    </div>
  )
}

const FIELD_LABELS = {
  fir_number: 'FIR / Crime No.', year: 'Year', district: 'District', station: 'Police Station',
  date_filed: 'Date of FIR', occurrence: 'Date of occurrence', acts: 'Acts', sections: 'Sections',
  offence: 'Offence', complainant: 'Complainant / Informant', address: 'Address',
  property: 'Property involved',
}

export default function VisualIntelligence() {
  const [tab, setTab] = useState('ocr')
  const navigate = useNavigate()

  // per-tab state
  const [img, setImg]         = useState({ ocr: null, face: null, evidence: null })
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState(null)
  const [ocrRes, setOcrRes]   = useState(null)
  const [faceRes, setFaceRes] = useState(null)
  const [evRes, setEvRes]     = useState(null)

  const setImageFor = (key) => (b64, error) => {
    setErr(error || null)
    if (b64) setImg(p => ({ ...p, [key]: b64 }))
  }

  const run = async (kind) => {
    setBusy(true); setErr(null)
    try {
      if (kind === 'ocr') {
        const r = await ocrIntake(img.ocr)
        if (r?.error) setErr(r.error === 'no_text_found'
          ? 'No readable text found in that image — try a sharper or better-lit scan.'
          : 'The OCR service could not process that image. Please try again.')
        else setOcrRes(r)
      }
      if (kind === 'face') {
        const r = await faceMatch(img.face)
        if (r?.error) setErr(`Face matching failed: ${r.detail || 'the service is unavailable.'}`)
        else setFaceRes(r)
      }
      if (kind === 'evidence') {
        const r = await evidenceAnalyze(img.evidence)
        if (r?.error) setErr('Object detection is unavailable right now. Please try again.')
        else setEvRes(r)
      }
    } catch {
      setErr('Connection error — please retry.')
    }
    setBusy(false)
  }

  return (
    <div className="p-6 bg-base text-white min-h-full space-y-5 font-mono">
      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Visual Intelligence"
        subtitle="Catalyst Zia image services — paper FIRs, suspect photos and scene evidence turned into analysable data"
        right={
          <div className="flex gap-1 flex-wrap">
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setErr(null) }} title={t.hint}
                className={`px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider font-bold transition-all border ${
                  tab === t.id ? 'bg-white text-base border-white'
                               : 'text-ink-faint border-base-border hover:text-white hover:border-white/40'}`}>
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {err && (
        <div className="kv-card p-3 flex items-start gap-2.5 border-risk-critical/30">
          <span className="text-risk-critical flex-shrink-0 mt-0.5"><IconAlert className="w-4 h-4" /></span>
          <p className="text-risk-critical text-xs leading-relaxed">{err}</p>
        </div>
      )}

      {/* ── FIR INTAKE ─────────────────────────────────────────────── */}
      {tab === 'ocr' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <ImageDrop value={img.ocr} onPick={setImageFor('ocr')} disabled={busy}
              label="Upload a scanned or photographed FIR" />
            <RunButton onClick={() => run('ocr')} busy={busy} disabled={!img.ocr}>Extract case data</RunButton>
            <Callout tone="info">
              Paper records are the biggest blind spot in crime analytics. Zia OCR converts them into
              structured fields, so a scanned FIR becomes part of every dashboard, chart and query.
            </Callout>
          </div>

          <div className="space-y-4">
            {!ocrRes && <div className="kv-card p-10 text-center text-ink-faint text-xs">Extracted case fields will appear here.</div>}
            {ocrRes && (
              <>
                <div className="kv-card p-5 animate-fade-up">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h2 className="kv-title">Extracted case record</h2>
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full border border-risk-low/40 bg-risk-low/10 text-risk-low flex items-center gap-1.5">
                      <IconCheck className="w-3 h-3" />{ocrRes.confidence ?? '—'}% OCR confidence
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
                    {Object.entries(FIELD_LABELS).map(([k, label]) => (
                      <div key={k} className="border-b border-base-border/50 pb-2">
                        <p className="text-ink-faint text-[9px] uppercase tracking-wider mb-0.5">{label}</p>
                        <p className={`text-[12px] font-bold ${ocrRes.fields?.[k] ? 'text-white' : 'text-ink-faint'}`}>
                          {ocrRes.fields?.[k] || 'not found'}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-ink-faint mt-4">
                    {ocrRes.extractedCount}/{ocrRes.fieldCount ?? Object.keys(FIELD_LABELS).length} fields recognised automatically · review before filing
                  </p>
                </div>

                {ocrRes.entities?.length > 0 && (
                  <div className="kv-card p-5">
                    <h2 className="kv-title mb-3">Zia entities detected</h2>
                    <div className="flex flex-wrap gap-1.5">
                      {ocrRes.entities.slice(0, 24).map((e, i) => (
                        <span key={i} className="text-[10px] px-2 py-1 rounded-lg bg-base border border-base-border text-ink-dim">
                          {e.token} <span className="text-ink-faint">· {e.ner_tag}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <details className="kv-card p-5">
                  <summary className="kv-title cursor-pointer">Raw OCR text</summary>
                  <pre className="text-[11px] text-ink-dim whitespace-pre-wrap leading-relaxed mt-3">{ocrRes.text}</pre>
                </details>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── FACE MATCH ─────────────────────────────────────────────── */}
      {tab === 'face' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <ImageDrop value={img.face} onPick={setImageFor('face')} disabled={busy}
              label="Upload a suspect or CCTV still" />
            <RunButton onClick={() => run('face')} busy={busy} disabled={!img.face}>Search accused gallery</RunButton>
            <Callout tone="warning">
              Face comparison returns investigative leads ranked by similarity — never an identification
              on its own. Every search is access-controlled and logged for audit.
            </Callout>
          </div>

          <div className="space-y-3">
            {!faceRes && <div className="kv-card p-10 text-center text-ink-faint text-xs">Ranked gallery matches will appear here.</div>}
            {faceRes && (
              <div className="kv-card p-5 animate-fade-up">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h2 className="kv-title">Ranked matches</h2>
                  <span className="text-[10px] text-ink-faint">
                    {faceRes.comparedCount} gallery photo{faceRes.comparedCount === 1 ? '' : 's'} compared
                    {faceRes.gallerySource ? ` · ${faceRes.gallerySource === 'stratus' ? 'Stratus' : 'Data Store'}` : ''}
                  </span>
                </div>
                {faceRes.matches?.length ? (
                  <div className="space-y-3">
                    {faceRes.matches.map((m, i) => {
                      const c = m.confidence >= 80 ? '#F1493F' : m.confidence >= 60 ? '#F0A23D' : '#3291FF'
                      const risk = Number(m.risk_score) >= 80 ? '#F1493F' : Number(m.risk_score) >= 60 ? '#F0A23D' : '#2CB67D'
                      return (
                        <div key={m.accused_id}
                          className={`rounded-xl bg-base border transition ${i === 0 ? 'border-white/25' : 'border-base-border hover:border-white/20'}`}>
                          {/* identity + similarity */}
                          <div className="p-3.5">
                            <div className="flex justify-between items-start gap-3 mb-2">
                              <div className="min-w-0">
                                <p className="text-white text-sm font-bold truncate">{m.name || m.accused_id}</p>
                                <p className="text-ink-faint text-[10px]">
                                  {m.accused_id}{m.age ? ` · age ${m.age}` : ''}{m.gender ? ` · ${m.gender}` : ''}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <span className="text-sm font-black tabular" style={{ color: c }}>{Math.round(m.confidence)}%</span>
                                <p className="text-[8px] text-ink-faint uppercase tracking-wider">similarity</p>
                              </div>
                            </div>
                            <ConfidenceBar value={m.confidence} color={c} />
                          </div>

                          {/* full dossier — only worth the space for real hits */}
                          {m.district && (
                            <div className="px-3.5 pb-3.5 space-y-3">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 border-t border-base-border/60">
                                {[
                                  ['District', m.district],
                                  ['Primary crime', m.primary_crime],
                                  ['Case status', m.status],
                                  ['Linked FIRs', m.fir_count],
                                ].map(([k, v]) => (
                                  <div key={k}>
                                    <p className="text-ink-faint text-[9px] uppercase tracking-wider">{k}</p>
                                    <p className="text-ink text-[11px] font-bold truncate">{v ?? '—'}</p>
                                  </div>
                                ))}
                              </div>

                              <div className="flex items-center gap-2.5">
                                <div className="flex-1">
                                  <div className="flex justify-between text-[9px] text-ink-faint uppercase tracking-wider mb-1">
                                    <span>Risk score</span><span className="tabular">{m.risk_score}/100</span>
                                  </div>
                                  <ConfidenceBar value={m.risk_score} color={risk} />
                                </div>
                                {Number(m.is_repeat_offender) === 1 && (
                                  <span className="text-[8px] font-bold px-1.5 py-1 rounded border border-risk-critical/50 bg-risk-critical/10 text-risk-critical flex-shrink-0">
                                    REPEAT ×{m.repeat_case_count}
                                  </span>
                                )}
                              </div>

                              {m.firs?.length > 0 && (
                                <div>
                                  <p className="text-ink-faint text-[9px] uppercase tracking-wider mb-1.5">Linked cases</p>
                                  <div className="space-y-1">
                                    {m.firs.map((f, fi) => (
                                      <div key={fi} className="flex justify-between gap-2 text-[10px] bg-base-panel rounded-lg px-2 py-1.5">
                                        <span className="text-ink font-bold flex-shrink-0">{f.fir_number}</span>
                                        <span className="text-ink-dim truncate">{f.crime} · {f.district}</span>
                                        <span className="text-ink-faint flex-shrink-0">{f.status}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <button onClick={() => navigate('/dashboard/profiler')}
                                className="text-[10px] text-ink-faint hover:text-white flex items-center gap-1 transition">
                                Open full dossier in Criminal Profiler <IconArrowUpRight className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-ink-faint text-xs py-8 text-center leading-relaxed">
                    {faceRes.note === 'no_gallery_photos'
                      ? 'No accused photos in the gallery yet — add photos from the Criminal Profiler first.'
                      : faceRes.note === 'no_face_in_probe'
                        ? 'No face detected in the uploaded image. Use a clear, front-facing photo.'
                        : 'No gallery photo matched this face.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── EVIDENCE ANALYSIS ──────────────────────────────────────── */}
      {tab === 'evidence' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <ImageDrop value={img.evidence} onPick={setImageFor('evidence')} disabled={busy}
              label="Upload a crime-scene or evidence photo" />
            <RunButton onClick={() => run('evidence')} busy={busy} disabled={!img.evidence}>Detect objects</RunButton>
            <Callout tone="info">
              Detected objects become structured tags on the case — turning photo evidence into a
              dimension you can filter and chart alongside crime type, district and time.
            </Callout>
          </div>

          <div className="space-y-3">
            {!evRes && <div className="kv-card p-10 text-center text-ink-faint text-xs">Detected objects will appear here.</div>}
            {evRes && (
              <div className="kv-card p-5 animate-fade-up">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h2 className="kv-title">Detected objects</h2>
                  <span className="text-[10px] text-ink-faint">{evRes.count} found</span>
                </div>
                {evRes.objects?.length ? (
                  <div className="space-y-3">
                    {evRes.objects.map((o, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-[11px] mb-1.5">
                          <span className="text-white capitalize">{o.name}</span>
                          <span className="text-ink-dim tabular">{Math.round(o.confidence > 1 ? o.confidence : o.confidence * 100)}%</span>
                        </div>
                        <ConfidenceBar value={o.confidence > 1 ? o.confidence : o.confidence * 100} color="#A78BFA" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-ink-faint text-xs py-8 text-center">
                    No recognisable objects in that image. Scene photos with vehicles, weapons or bags work best.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
