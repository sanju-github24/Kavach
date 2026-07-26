import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { dataQuery } from '../api.js'

// KAVACH Spotlight — proactively surfaces the single most important thing to
// look at on each module page, plus nav "attention" badges showing which
// pages have something noteworthy. Fetches the per-module insights once, polls
// every 45s, and diffs each insight's metric against a persisted snapshot so
// it can show "changed since your last visit" when the live data moves.

const SpotlightCtx = createContext(null)
const SNAP_KEY    = 'kavach_spotlight_snapshot'
const DISMISS_KEY = 'kavach_spotlight_dismissed'
const POLL_MS     = 45000

const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

export function SpotlightProvider({ children }) {
  const [modules, setModules]     = useState({})       // { moduleId: [insight{…, changed, prevValue}] }
  const [dismissed, setDismissed] = useState(() => loadJSON(DISMISS_KEY))
  const snapshotRef = useRef(loadJSON(SNAP_KEY))

  const fetchSpotlights = useCallback(async () => {
    let res
    try { res = await dataQuery('spotlights') } catch { return }
    if (!res?.modules) return
    const snap = snapshotRef.current
    const nextSnap = { ...snap }
    const withDiff = {}
    for (const [mod, list] of Object.entries(res.modules)) {
      withDiff[mod] = (list || []).map(ins => {
        const key = ins.metric?.key
        const cur = ins.metric?.value
        const prev = key != null ? snap[key] : undefined
        const changed = prev !== undefined && cur !== undefined && prev !== cur
        if (key != null) nextSnap[key] = cur
        return { ...ins, changed, prevValue: changed ? prev : null }
      })
    }
    snapshotRef.current = nextSnap
    saveJSON(SNAP_KEY, nextSnap)
    setModules(withDiff)
  }, [])

  useEffect(() => {
    fetchSpotlights()
    const t = setInterval(fetchSpotlights, POLL_MS)
    return () => clearInterval(t)
  }, [fetchSpotlights])

  // Stable per-insight id so a dismissal sticks to that exact value, but
  // re-appears if the underlying metric changes to something new.
  const insightId = (ins) => `${ins.metric?.key || ins.title}:${ins.metric?.value ?? ''}`

  const getInsights = useCallback((moduleId) =>
    (modules[moduleId] || []).filter(ins => !dismissed[insightId(ins)])
  , [modules, dismissed])

  // Badge for a nav item: count of live (non-dismissed) insights + whether any
  // is critical (drives colour) + whether any changed since last snapshot.
  const moduleBadge = useCallback((moduleId) => {
    const live = (modules[moduleId] || []).filter(ins => !dismissed[insightId(ins)])
    return {
      count: live.length,
      critical: live.some(i => i.level === 'critical'),
      changed: live.some(i => i.changed),
    }
  }, [modules, dismissed])

  const dismiss = useCallback((ins) => {
    setDismissed(d => { const n = { ...d, [insightId(ins)]: true }; saveJSON(DISMISS_KEY, n); return n })
  }, [])

  return (
    <SpotlightCtx.Provider value={{ getInsights, moduleBadge, dismiss }}>
      {children}
    </SpotlightCtx.Provider>
  )
}

export const useSpotlight = () => useContext(SpotlightCtx) || { getInsights: () => [], moduleBadge: () => ({ count: 0 }), dismiss: () => {} }
