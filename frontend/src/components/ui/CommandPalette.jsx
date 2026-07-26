import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function CommandPalette({ items }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e) {
      const isK = e.key.toLowerCase() === 'k'
      if ((e.metaKey || e.ctrlKey) && isK) { e.preventDefault(); setOpen(o => !o) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [open])

  const filtered = items.filter(i =>
    !query || i.label.toLowerCase().includes(query.toLowerCase()) || i.keywords?.toLowerCase().includes(query.toLowerCase())
  )

  function go(item) {
    setOpen(false)
    if (item.route) navigate(item.route)
    else item.action?.()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && filtered[active]) go(filtered[active])
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg kv-panel shadow-glow overflow-hidden animate-fade-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-base-border">
          <span className="text-accent text-sm">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a module or run a command…"
            className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none"
          />
          <kbd className="text-[9px] font-mono text-ink-faint border border-base-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <p className="text-center text-ink-faint text-xs py-8">No matches</p>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.label}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === active ? 'bg-accent/10 text-white' : 'text-ink-dim hover:bg-base-raised'
              }`}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              <span className="text-sm flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-[9px] font-mono text-ink-faint">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
