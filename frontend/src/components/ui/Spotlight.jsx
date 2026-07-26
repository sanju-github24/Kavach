import { useState, useEffect } from 'react'
import { useSpotlight } from '../../contexts/SpotlightContext'

// KAVACH Spotlight — a proactive, hard-to-miss notification. The moment the
// officer lands on a page, KAVACH drops a prominent card DOWN from the top-
// centre of the screen so the key insight is the first thing they see. It
// stays a few seconds, then tucks into a small pulsing beacon in the corner
// that can be tapped to bring it back — so it demands attention on arrival
// without permanently blocking the page.

const LEVEL = {
  critical: { c: '#F1493F', chip: 'text-risk-critical border-risk-critical/40 bg-risk-critical/10', tag: 'PRIORITY',  word: 'Act now' },
  high:     { c: '#F59E0B', chip: 'text-risk-high border-risk-high/40 bg-risk-high/10',              tag: 'ATTENTION', word: 'Worth a look' },
  info:     { c: '#A78BFA', chip: 'text-[#C4B5FD] border-[#A78BFA]/40 bg-[#A78BFA]/10',              tag: 'INSIGHT',   word: 'Heads up' },
}

const AUTO_COLLAPSE_MS = 9000

export default function Spotlight({ module }) {
  const { getInsights, dismiss } = useSpotlight()
  const [open, setOpen]       = useState(false)
  const [entered, setEntered] = useState(false)
  const insights = getInsights(module)
  const ins = insights[0]
  const key = ins?.metric?.key || ins?.title

  // On page arrival (or when the insight changes): drop the card from the top,
  // then auto-settle to the corner beacon after a few seconds.
  useEffect(() => {
    if (!ins) { setOpen(false); return }
    setOpen(true); setEntered(false)
    const raf = requestAnimationFrame(() => setEntered(true))
    const t = setTimeout(() => setOpen(false), AUTO_COLLAPSE_MS)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [module, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ins) return null
  const lv = LEVEL[ins.level] || LEVEL.info

  return (
    <>
      {/* Prominent top-centre card — slides down on arrival, forces attention */}
      {open && (
        <div className="fixed top-5 left-1/2 z-[60] w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 font-mono transition-all duration-500 ease-out"
          style={{ transform: `translateX(-50%) translateY(${entered ? '0' : '-24px'})`, opacity: entered ? 1 : 0 }}>
          <div className="bg-[#0A0A0A] border border-[#2E2E2E] rounded-2xl overflow-hidden"
            style={{ borderTop: `3px solid ${lv.c}`, boxShadow: `0 24px 60px -12px rgba(0,0,0,0.85), 0 0 0 1px ${lv.c}22, 0 0 40px -6px ${lv.c}66` }}>
            <div className="p-5 pr-10 relative">
              <div className="flex items-center gap-2 mb-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: lv.c }} />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: lv.c }} />
                </span>
                <span className="text-[10px] font-bold tracking-widest" style={{ color: lv.c }}>KAVACH · {lv.word.toUpperCase()}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border tracking-wider ${lv.chip}`}>{lv.tag}</span>
                {ins.changed && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-[#A78BFA]/40 bg-[#A78BFA]/10 text-[#C4B5FD] tracking-wider">
                    {ins.prevValue}{ins.metric?.unit || ''} → {ins.metric?.value}{ins.metric?.unit || ''}
                  </span>
                )}
              </div>
              <p className="text-white text-base font-bold leading-snug">{ins.title}</p>
              <p className="text-gray-400 text-[12.5px] leading-relaxed mt-1.5">{ins.detail}</p>
              <button onClick={() => { dismiss(ins); setOpen(false) }}
                className="absolute top-4 right-4 w-6 h-6 rounded-lg flex items-center justify-center text-gray-600 hover:text-white hover:bg-white/5 transition text-sm" title="Dismiss">✕</button>
            </div>
            {/* auto-dismiss countdown bar */}
            <div className="h-0.5 w-full origin-left" style={{ background: lv.c, animation: `kv-shrink ${AUTO_COLLAPSE_MS}ms linear forwards` }} />
          </div>
        </div>
      )}

      {/* Persistent corner beacon — tap to bring the card back */}
      <button onClick={() => { setOpen(o => !o); setEntered(true) }}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[#0A0A0A] border border-[#2E2E2E] flex items-center justify-center shadow-2xl hover:scale-105 transition-transform"
        title={open ? 'Hide KAVACH insight' : 'KAVACH spotted something — tap to see'}>
        {!open && <span className="absolute inset-0 rounded-full animate-ping opacity-40" style={{ backgroundColor: lv.c }} />}
        <span className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${lv.c}55` }} />
        <svg width="22" height="22" viewBox="0 0 64 64" className="relative">
          <path d="M32 10 L48 15 V30 C48 42 41 50 32 54 C23 50 16 42 16 30 V15 Z" fill="#FFFFFF" />
          <circle cx="32" cy="31" r="10" fill="#0A0A0A" />
          <circle cx="32" cy="31" r="3.6" fill="#FFFFFF" />
        </svg>
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0A0A0A]" style={{ backgroundColor: lv.c }} />
      </button>

      <style>{`@keyframes kv-shrink { from { transform: scaleX(1) } to { transform: scaleX(0) } }`}</style>
    </>
  )
}
