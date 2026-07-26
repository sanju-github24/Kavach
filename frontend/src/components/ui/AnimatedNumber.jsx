import { useEffect, useRef, useState } from 'react'

// Counts up from 0 to `value` once, on mount / value change. Respects
// prefers-reduced-motion by jumping straight to the final value.
export default function AnimatedNumber({ value, duration = 700, format = (n) => Math.round(n).toLocaleString('en-IN') }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef(null)
  const start = useRef(null)
  const from = useRef(0)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const target = Number(value) || 0
    if (reduced) { setDisplay(target); return }

    from.current = display
    start.current = null
    cancelAnimationFrame(raf.current)

    function step(ts) {
      if (start.current === null) start.current = ts
      const progress = Math.min((ts - start.current) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from.current + (target - from.current) * eased)
      if (progress < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <span className="tabular">{format(display)}</span>
}
