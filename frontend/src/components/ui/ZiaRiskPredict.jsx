import { useState, useEffect } from 'react'
import { predictRisk } from '../../api.js'

// Zia AutoML risk prediction — sends the accused's structured features to the
// trained Catalyst Zia AutoML model and shows the predicted risk class with
// per-class confidence, alongside the heuristic score. Degrades gracefully:
// if the model isn't trained/configured yet it shows a short setup hint; if
// the call fails it says so — the heuristic score is always still shown above.

const CLASS_COLOR = { Low: '#22C55E', Medium: '#F59E0B', High: '#F1493F', Critical: '#DC2626' }

export default function ZiaRiskPredict({ p }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    let alive = true
    setState({ loading: true, data: null, error: null })
    predictRisk({
      age: p.age,
      gender: p.gender,
      district: p.district,
      primary_crime: p.primary_crime,
      repeat_case_count: p.repeat_case_count ?? p.fir_count ?? 1,
      is_repeat_offender: p.is_repeat_offender ?? 0,
    })
      .then(res => {
        if (!alive) return
        if (res?.error) setState({ loading: false, data: null, error: res.error })
        else setState({ loading: false, data: res.prediction || null, error: null })
      })
      .catch(() => alive && setState({ loading: false, data: null, error: 'automl_unavailable' }))
    return () => { alive = false }
  }, [p.accused_id])

  // QuickML returns { label, confidence, explanation:{ data:[[feature,value,contribution],…] } }.
  // The older Zia AutoML shape (classification_result) is still handled so the
  // panel keeps working if the project is pointed back at that model.
  const label      = state.data?.label ?? null
  const confidence = state.data?.confidence ?? null
  const classResult = state.data?.classification_result || null
  const regression  = state.data?.regression_result
  const rawRanked = classResult ? Object.entries(classResult).sort((a, b) => b[1] - a[1]) : []
  const isPercent = rawRanked.length ? Math.max(...rawRanked.map(([, v]) => v)) > 1 : false
  const pct = (v) => Math.round(isPercent ? v : v * 100)
  const ranked = rawRanked.map(([cls, v]) => [cls, pct(v)])
  const top = ranked[0]

  // Feature attribution: which inputs actually drove this prediction.
  const contributions = (() => {
    const rows = state.data?.explanation?.data
    if (!Array.isArray(rows)) return []
    const cleaned = rows
      .map(r => ({ feature: String(r?.[0] ?? ''), contribution: Number(r?.[2] ?? 0) }))
      .filter(r => r.feature && Number.isFinite(r.contribution) && r.contribution > 0.001)
      .sort((a, b) => b.contribution - a.contribution)
    const total = cleaned.reduce((s, r) => s + r.contribution, 0) || 1
    return cleaned.slice(0, 5).map(r => ({ ...r, share: Math.round((r.contribution / total) * 100) }))
  })()

  const PRETTY = {
    primary_crime: 'Primary crime', is_repeat_offender: 'Repeat offender',
    repeat_case_count: 'Repeat case count', age: 'Age', gender: 'Gender', district: 'District',
  }
  const prettyFeature = (f) => PRETTY[f] || f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div className="bg-[#0A0A0A] border border-[#2E2E2E] rounded-xl p-5" style={{ borderLeft: '3px solid #A78BFA' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <span className="text-[#A78BFA]">◆</span> Zia AutoML · Risk Prediction
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">Catalyst Zia AutoML · trained ML model on accused features</p>
        </div>
        {top && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border"
            style={{ color: CLASS_COLOR[top[0]] || '#A78BFA', borderColor: (CLASS_COLOR[top[0]] || '#A78BFA') + '66', background: (CLASS_COLOR[top[0]] || '#A78BFA') + '1A' }}>
            {top[0]} · {top[1]}%
          </span>
        )}
      </div>

      {state.loading && (
        <div className="flex items-center gap-2 text-gray-500 text-[11px]">
          <span className="w-3 h-3 border-2 border-[#A78BFA]/40 border-t-[#A78BFA] rounded-full animate-spin" />
          Scoring with the AutoML model…
        </div>
      )}

      {state.error === 'model_not_configured' && (
        <div className="text-[11px] text-gray-400 leading-relaxed">
          <p className="text-gray-300 mb-1.5">ML prediction is ready to switch on.</p>
          <p className="text-gray-500">Train the model in <span className="text-[#A78BFA]">Zia → AutoML</span> using <span className="text-gray-300">backend/kavach_risk_training.csv</span>, then set <span className="text-gray-300">ZIA_AUTOML_MODEL_ID</span> in the function environment. Until then the heuristic score above is used.</p>
        </div>
      )}

      {state.error === 'automl_unavailable' && (
        <p className="text-gray-600 text-[11px]">The AutoML model could not be reached right now — showing the heuristic score above.</p>
      )}

      {!state.loading && !state.error && (
        <div className="space-y-2 mt-1">
          {ranked.map(([cls, prob]) => (
            <div key={cls}>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-400">{cls} risk</span>
                <span className="tabular-nums" style={{ color: CLASS_COLOR[cls] || '#A78BFA' }}>{prob}%</span>
              </div>
              <div className="w-full bg-[#000000] h-1.5 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${prob}%`, background: CLASS_COLOR[cls] || '#A78BFA' }} />
              </div>
            </div>
          ))}
          {regression != null && !ranked.length && (
            <p className="text-white text-lg font-bold">Predicted risk: {Math.round(regression)}<span className="text-gray-500 text-sm">/100</span></p>
          )}

          {/* QuickML classification + why the model said it */}
          {label && !ranked.length && (
            <>
              <div className="flex items-baseline gap-2.5">
                <span className="text-2xl font-black" style={{ color: CLASS_COLOR[label] || '#A78BFA' }}>{label}</span>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">predicted risk class</span>
                {confidence != null && (
                  <span className="ml-auto text-[11px] tabular-nums text-gray-400">{Math.round(confidence)}% confidence</span>
                )}
              </div>

              {contributions.length > 0 && (
                <div className="pt-1">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-2">Why the model said this</p>
                  <div className="space-y-2">
                    {contributions.map(c => (
                      <div key={c.feature}>
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-gray-400">{prettyFeature(c.feature)}</span>
                          <span className="tabular-nums text-gray-400">{c.share}%</span>
                        </div>
                        <div className="w-full bg-[#000000] h-1.5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${c.share}%`, background: '#A78BFA' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-600 text-[9px] mt-2">Feature attribution from the deployed QuickML pipeline.</p>
                </div>
              )}
            </>
          )}

          <p className="text-gray-600 text-[10px] pt-1">Heuristic score: {p.risk_score}/100 · the ML prediction is independent and model-driven.</p>
        </div>
      )}
    </div>
  )
}
