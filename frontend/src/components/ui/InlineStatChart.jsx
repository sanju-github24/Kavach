import ReactECharts from 'echarts-for-react'

const DARK = { textStyle: { color: '#A1A1A1', fontFamily: 'monospace' }, backgroundColor: 'transparent' }
const PALETTE = ['#FFFFFF', '#60A5FA', '#F0A23D', '#F1493F', '#2CB67D', '#A78BFA', '#ec4899']

// Bold "highlight" chips only capture spans that are purely digits (e.g.
// "**48**"), which misses how these replies actually read — "**Bengaluru
// Urban:** 48 cases", "**3 cases** on record". Parsing the reply text
// directly for "**Label** ... N cases/%" pairs is what actually finds
// chartable numbers in a real answer.
//
// Finds true bold-span boundaries first (matchAll on a single **...** pair),
// then looks at what immediately follows each span in the ORIGINAL text.
// A single regex scanning "**A**...**B**" end-to-end can mis-pair the
// closing ** of one span with the opening ** of the next, swallowing the
// plain-text gap between two adjacent bold spans as if it were bold content
// itself (e.g. "**risk (83)**. He has **3 cases**" produced a garbage
// "He has: 3" bar) — anchoring on real spans avoids that entirely.
function extractBars(text) {
  const seen = new Set()
  const bars = []
  const boldRe = /\*\*([^*]{1,40})\*\*/g
  let m
  while ((m = boldRe.exec(text)) && bars.length < 8) {
    const label = m[1].trim().replace(/:$/, '')
    if (!label || /^\d+$/.test(label)) continue
    const after = text.slice(boldRe.lastIndex, boldRe.lastIndex + 20)
    const numMatch = after.match(/^:?\s*\(?(\d+(?:\.\d+)?)/)
    if (!numMatch) continue
    const value = Number(numMatch[1])
    if (Number.isNaN(value)) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    bars.push({ label, value })
  }
  return bars
}

// A compact chart rendered inline in a chat message — gives statistics-heavy
// or comparison answers a quick visual confirmation, not just text. Honors
// an explicit chart type the officer asked for (bar/pie/line/radar/table);
// defaults to a horizontal bar when nothing specific was requested.
//
// `forcedBars` (when provided) wins over everything else — for comparison
// answers the backend already computed the exact structured data (e.g. each
// accused's risk score) before ever calling the RAG, so it's guaranteed
// correct regardless of whether the model's prose happens to phrase the
// numbers in the exact "**Label**: N" pattern text-parsing looks for.
export default function InlineStatChart({ text, highlights, chartType, forcedBars }) {
  let bars = Array.isArray(forcedBars) && forcedBars.length >= 2 ? forcedBars : extractBars(text || '')

  if (bars.length < 2) {
    bars = (highlights || [])
      .map(h => ({ label: h.label, value: Number(String(h.value).replace(/[^\d.-]/g, '')) }))
      .filter(h => h.label && !Number.isNaN(h.value))
  }
  if (bars.length < 2) return null

  bars = bars.slice(0, 6)
  const type = chartType || 'bar'
  const label = type === 'pie' ? 'Distribution' : type === 'line' ? 'Trend' : type === 'radar' ? 'Comparison' : type === 'table' ? 'Data' : 'At a glance'

  if (type === 'table') {
    return (
      <div className="mt-3 border border-base-border rounded-xl overflow-hidden">
        <p className="text-[9px] text-ink-faint uppercase tracking-widest px-3 pt-2.5 pb-1.5">{label}</p>
        <table className="w-full text-xs">
          <tbody>
            {bars.map((b, i) => (
              <tr key={i} className="border-t border-base-border first:border-t-0">
                <td className="px-3 py-1.5 text-ink-dim">{b.label}</td>
                <td className="px-3 py-1.5 text-white font-bold text-right tabular-nums">{b.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  let option
  if (type === 'pie') {
    option = {
      ...DARK,
      tooltip: { trigger: 'item' },
      legend: { show: false },
      series: [{
        type: 'pie', radius: ['35%', '70%'], avoidLabelOverlap: true,
        data: bars.map((b, i) => ({ name: b.label, value: b.value, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        label: { color: '#A1A1A1', fontSize: 10 },
        labelLine: { lineStyle: { color: '#2E2E2E' } },
      }],
    }
  } else if (type === 'line') {
    option = {
      ...DARK,
      grid: { top: 12, bottom: 24, left: 8, right: 12, containLabel: true },
      xAxis: { type: 'category', data: bars.map(b => b.label), axisLabel: { color: '#A1A1A1', fontSize: 9 }, axisLine: { lineStyle: { color: '#2E2E2E' } } },
      yAxis: { type: 'value', show: false },
      series: [{
        type: 'line', data: bars.map(b => b.value), smooth: true, symbolSize: 7,
        lineStyle: { color: '#FFFFFF', width: 2 }, itemStyle: { color: '#FFFFFF' },
        label: { show: true, position: 'top', color: '#FAFAFA', fontSize: 10, fontWeight: 'bold' },
        areaStyle: { color: 'rgba(255,255,255,0.06)' },
      }],
    }
  } else if (type === 'radar') {
    const maxVal = Math.max(...bars.map(b => b.value), 1)
    const indicatorMax = maxVal <= 100 ? 100 : Math.ceil(maxVal * 1.2)
    option = {
      ...DARK,
      radar: {
        indicator: bars.map(b => ({ name: b.label, max: indicatorMax })),
        axisName: { color: '#A1A1A1', fontSize: 9 },
        splitLine: { lineStyle: { color: '#2E2E2E' } },
        axisLine: { lineStyle: { color: '#2E2E2E' } },
        splitArea: { show: false },
      },
      series: [{
        type: 'radar', data: [{ value: bars.map(b => b.value), name: label, areaStyle: { color: 'rgba(255,255,255,0.12)' } }],
        lineStyle: { color: '#FFFFFF' }, itemStyle: { color: '#FFFFFF' },
      }],
    }
  } else {
    // bar (default)
    option = {
      ...DARK,
      grid: { top: 8, bottom: 8, left: 8, right: 40, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: bars.map(b => b.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#A1A1A1', fontSize: 10 } },
      series: [{
        type: 'bar', data: bars.map((b, i) => ({ value: b.value, itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0, 4, 4, 0] } })), barWidth: 14,
        label: { show: true, position: 'right', color: '#FAFAFA', fontSize: 10, fontWeight: 'bold' },
      }],
    }
  }

  const height = type === 'pie' || type === 'radar' ? 200 : Math.max(90, bars.length * 34)

  return (
    <div className="mt-3 border border-base-border rounded-xl overflow-hidden">
      <p className="text-[9px] text-ink-faint uppercase tracking-widest px-3 pt-2.5">{label}</p>
      <ReactECharts style={{ height }} option={option} />
    </div>
  )
}
