import { useState } from 'react'
import { translateText } from '../../api.js'

// One-click Kannada rendering for any block of text, powered by the Catalyst
// Zia translation model. Kept as a toggle so the officer can always see the
// original English alongside — a translation should never hide the source.
export default function TranslateToggle({ text, className = '' }) {
  const [state, setState] = useState({ busy: false, kn: null, show: false, err: null })

  const onClick = async () => {
    if (state.kn) { setState(s => ({ ...s, show: !s.show })); return }
    setState(s => ({ ...s, busy: true, err: null }))
    try {
      const r = await translateText(text, 'en', 'kn')
      if (r?.translated) setState({ busy: false, kn: r.translated, show: true, err: null })
      else setState({ busy: false, kn: null, show: false, err: 'Translation unavailable right now.' })
    } catch {
      setState({ busy: false, kn: null, show: false, err: 'Translation failed — check the connection.' })
    }
  }

  if (!text || !text.trim()) return null

  return (
    <div className={className}>
      <button onClick={onClick} disabled={state.busy}
        className="text-[10px] text-ink-faint hover:text-accent transition flex items-center gap-1.5 disabled:opacity-50">
        {state.busy ? 'Translating…' : state.show ? 'Hide ಕನ್ನಡ' : 'ಕನ್ನಡದಲ್ಲಿ ನೋಡಿ'}
      </button>
      {state.err && <p className="text-[10px] text-risk-high mt-1">{state.err}</p>}
      {state.show && state.kn && (
        <div className="mt-2 p-3 rounded-xl bg-base border border-base-border">
          <p className="text-[9px] text-ink-faint uppercase tracking-widest mb-1.5">Kannada · Catalyst Zia</p>
          <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{state.kn}</p>
        </div>
      )}
    </div>
  )
}
