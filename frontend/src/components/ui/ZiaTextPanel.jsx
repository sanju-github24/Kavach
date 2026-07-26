import { useState, useEffect } from 'react'
import { analyzeText } from '../../api.js'

// Zia Text Intelligence — runs Catalyst Zia Text Analytics (keyword extraction,
// named-entity recognition, sentiment/tone) on the investigating officer's
// free-text case narrative (BriefFacts), turning unstructured prose into
// structured, scannable intelligence. Renders nothing if there's no narrative
// or the Zia service is unavailable, so it never breaks the page.

const TONE_STYLE = {
  Negative: { label: 'Negative', cls: 'text-risk-critical border-risk-critical/40 bg-risk-critical/10' },
  Neutral:  { label: 'Neutral',  cls: 'text-ink-dim border-base-border bg-white/5' },
  Positive: { label: 'Positive', cls: 'text-risk-low border-risk-low/40 bg-risk-low/10' },
}

// Zia's raw NER tags → readable category labels.
const TAG_LABEL = {
  Unit_money: 'Money', Money: 'Money', Number: 'Numbers', Date: 'Dates', Time: 'Times',
  Organization: 'Organizations', Person: 'People', Location: 'Locations', Percentage: 'Percentages',
}

// Two modes:
//   • narrative  → fetch Zia analysis for that text (Case Insight page)
//   • data       → render already-computed Zia output (chat MO answers), no fetch
export default function ZiaTextPanel({ narrative, data: providedData, title = 'Zia Text Intelligence', subtitle = 'Catalyst Zia · Text Analytics on the case narrative' }) {
  const [state, setState] = useState({ loading: false, data: providedData || null, failed: false })
  const prewired = !!providedData

  useEffect(() => {
    if (prewired) { setState({ loading: false, data: providedData, failed: false }); return }
    const text = (narrative || '').trim()
    if (text.length < 15) { setState({ loading: false, data: null, failed: false }); return }
    let alive = true
    setState({ loading: true, data: null, failed: false })
    analyzeText([text])
      .then(res => {
        if (!alive) return
        if (!res || res.error) { setState({ loading: false, data: null, failed: true }); return }
        setState({ loading: false, data: res, failed: false })
      })
      .catch(() => alive && setState({ loading: false, data: null, failed: true }))
    return () => { alive = false }
  }, [narrative, providedData])

  if (!prewired && (!narrative || (narrative || '').trim().length < 15)) return null

  const kw = state.data?.keywords?.[0]?.keyword_extractor || {}
  const keywords = [...new Set([...(kw.keywords || []), ...(kw.keyphrases || [])])]
  const ents = state.data?.entities?.[0]?.ner?.general_entities || []
  const tone = state.data?.sentiment?.[0]?.sentiment_prediction?.[0]?.document_sentiment || null

  const byTag = {}
  ents.forEach(e => { if (e?.token) (byTag[e.ner_tag] ??= new Set()).add(e.token) })
  const entGroups = Object.entries(byTag)

  return (
    <div className="bg-[#0A0A0A] border border-[#2E2E2E] rounded-xl p-5" style={{ borderLeft: '3px solid #A78BFA' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <span className="text-[#A78BFA]">◆</span> {title}
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        {tone && (
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${(TONE_STYLE[tone] || TONE_STYLE.Neutral).cls}`}>
            Tone · {(TONE_STYLE[tone] || TONE_STYLE.Neutral).label}
          </span>
        )}
      </div>

      {/* Narrative excerpt (fetch mode only) */}
      {narrative && (
        <p className="text-gray-400 text-[11px] leading-relaxed italic border-l-2 border-[#2E2E2E] pl-3 mb-4">
          "{narrative.length > 240 ? narrative.slice(0, 240) + '…' : narrative}"
        </p>
      )}

      {state.loading && (
        <div className="flex items-center gap-2 text-gray-500 text-[11px]">
          <span className="w-3 h-3 border-2 border-[#A78BFA]/40 border-t-[#A78BFA] rounded-full animate-spin" />
          Analysing narrative with Zia…
        </div>
      )}

      {state.failed && (
        <p className="text-gray-600 text-[11px]">Zia Text Analytics is not available right now.</p>
      )}

      {!state.loading && !state.failed && state.data && (
        <div className="space-y-4">
          {keywords.length > 0 && (
            <div>
              <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-2">Key Terms &amp; Phrases</p>
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((k, i) => (
                  <span key={i} className="text-[11px] bg-[#A78BFA]/10 border border-[#A78BFA]/30 text-[#C4B5FD] px-2 py-0.5 rounded-md">{k}</span>
                ))}
              </div>
            </div>
          )}

          {entGroups.length > 0 && (
            <div>
              <p className="text-gray-600 text-[9px] uppercase tracking-wider mb-2">Recognised Entities</p>
              <div className="space-y-1.5">
                {entGroups.map(([tag, set]) => (
                  <div key={tag} className="flex items-start gap-2 text-[11px]">
                    <span className="text-gray-500 min-w-[80px] shrink-0">{TAG_LABEL[tag] || tag}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {[...set].map((tok, i) => (
                        <span key={i} className="bg-[#000000] border border-[#2E2E2E] text-gray-200 px-1.5 py-0.5 rounded">{tok}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keywords.length === 0 && entGroups.length === 0 && (
            <p className="text-gray-600 text-[11px]">No distinct keywords or entities were extracted from this narrative.</p>
          )}
        </div>
      )}
    </div>
  )
}
