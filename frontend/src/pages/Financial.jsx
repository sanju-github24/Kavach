import { useState, useEffect, useMemo, useRef } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import ReactECharts from 'echarts-for-react'
import { fetchFinancial } from '../api.js'
import { PageHeader, Callout, KpiCard } from '../components/ui/Panel'

const DARK = { textStyle: { color: '#A1A1A1', fontFamily: 'monospace' }, backgroundColor: 'transparent' }

export default function Financial() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const cyRef = useRef(null)

  useEffect(() => {
    fetchFinancial()
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const d = data || {}
  const nodes = d.nodes || []
  const edges = d.edges || []
  const stats = d.stats || {}

  const elements = useMemo(() => [
    ...nodes.map(n => ({
      data: { id:n.id, label:n.label, ...n },
      classes: n.type === 'account' ? (n.flagged ? 'account-flagged' : 'account') : 'accused',
    })),
    ...edges.map((e,i) => ({
      data: { id:`fe${i}`, source:e.source, target:e.target, label:e.label },
      classes: e.flagged ? 'flow-flagged' : 'flow',
    })),
  ], [nodes, edges])

  const COSE_LAYOUT = {
    name:'cose', animate:false, fit:true, padding:30,
    nodeRepulsion:450000, idealEdgeLength:130, nestingFactor:1.2,
    gravity:60, numIter:2000, tile:true, tilingPaddingVertical:20, tilingPaddingHorizontal:20,
    componentSpacing:120,
  }

  // react-cytoscapejs only applies `layout` once on mount — the async fetch
  // replaces empty initial elements with real data afterwards, so without an
  // explicit re-run every node lands at the default position (all stacked).
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !elements.length) return
    const id = requestAnimationFrame(() => { cy.layout(COSE_LAYOUT).run() })
    return () => cancelAnimationFrame(id)
  }, [elements])

  const stylesheet = [
    { selector: 'node', style: {
      'label': 'data(label)', 'color': '#FAFAFA', 'font-size': 9, 'font-family':'monospace',
      'text-valign': 'bottom', 'text-margin-y': 6, 'width': 32, 'height': 32,
      'background-color': '#000000', 'border-width': 2,
    }},
    { selector: '.accused', style: { 'border-color': '#FFFFFF', 'shape':'ellipse' } },
    { selector: '.account', style: { 'border-color': '#60A5FA', 'shape':'round-rectangle' } },
    { selector: '.account-flagged', style: { 'border-color': '#F1493F', 'background-color': '#F1493F22', 'shape':'round-rectangle' } },
    { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 3 } },
    { selector: 'edge', style: {
      'width': 2, 'line-color': '#2E2E2E', 'curve-style': 'bezier', 'target-arrow-shape':'triangle',
      'target-arrow-color': '#2E2E2E', 'label':'data(label)', 'font-size': 7, 'color':'#F0A23D', 'font-family':'monospace',
    }},
    { selector: '.flow-flagged', style: { 'line-color': '#F1493F', 'target-arrow-color':'#F1493F', 'line-style':'dashed', 'width':2.5 } },
  ]

  const sankeyOption = {
    ...DARK,
    tooltip:{ trigger:'item' },
    series:[{
      type:'sankey', emphasis:{ focus:'adjacency' },
      data: [...new Set([...(d.sankey||[]).map(s=>s.source), ...(d.sankey||[]).map(s=>s.target)])].map(name => ({ name })),
      links: (d.sankey||[]).map(s => ({ source:s.source, target:s.target, value:s.value })),
      lineStyle:{ color:'gradient', curveness:0.5 },
      label:{ color:'#FAFAFA', fontSize:9 },
      itemStyle:{ color:'#F0A23D', borderColor:'#2E2E2E' },
    }],
  }

  const kpis = [
    { label:'Total Accounts',       value: stats.total_accounts || 0, color:'#FFFFFF' },
    { label:'Flagged Accounts',     value: stats.flagged_accounts || 0, color:'#F1493F' },
    { label:'Suspicious Txns',      value: stats.total_suspicious_txns || 0, color:'#F0A23D' },
    { label:'Suspicious Amount',    value: `₹${Number(stats.total_suspicious_amount||0).toLocaleString('en-IN')}`, color:'#A78BFA', isText:true },
  ]

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Financial Crime & Transaction Link Analysis"
        subtitle={loading ? 'Tracing money trails…' : `${nodes.length} entities · ${edges.length} money-flow links`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <KpiCard key={k.label} label={k.label} value={k.value} color={k.color} isText={k.isText} delay={i * 40} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 kv-card overflow-hidden animate-fade-up" style={{ height:440 }}>
          <div className="px-4 py-2.5 border-b border-[#2E2E2E] flex justify-between items-center flex-wrap gap-2">
            <span className="text-xs text-[#FFFFFF] font-bold uppercase tracking-wider">Money-Flow Graph — accused ↔ accounts</span>
            <button onClick={() => cyRef.current?.fit(undefined, 40)}
              className="text-[10px] px-2 py-1 rounded border border-[#2E2E2E] text-gray-400 hover:text-[#FFFFFF] hover:border-[#FFFFFF]/40">Fit</button>
          </div>
          <CytoscapeComponent
            elements={elements}
            stylesheet={stylesheet}
            style={{ width:'100%', height:'calc(100% - 40px)' }}
            layout={COSE_LAYOUT}
            cy={(cy) => {
              cyRef.current = cy
              cy.removeAllListeners()
              cy.on('tap', 'node', (evt) => setSelected(evt.target.data()))
              cy.on('tap', (evt) => { if (evt.target === cy) setSelected(null) })
            }}
          />
        </div>

        {/* Detail panel */}
        <div className="kv-card p-5 flex flex-col animate-fade-up">
          {selected ? (
            <>
              <h3 className="text-white font-black text-base mb-1">{selected.label}</h3>
              <p className="text-[#FFFFFF] text-[10px] font-mono mb-4">{selected.id} · {selected.type}</p>
              <div className="space-y-3 text-[11px]">
                {selected.type === 'account' ? (
                  <>
                    <Field label="Bank" value={selected.bank} />
                    <Field label="Flagged" value={selected.flagged ? 'YES' : 'No'} />
                    <Field label="Suspicious Amount" value={`₹${Number(selected.amount||0).toLocaleString('en-IN')}`} />
                  </>
                ) : (
                  <>
                    <Field label="District" value={selected.district} />
                    <Field label="Risk Score" value={`${selected.risk}/100`} />
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-4 opacity-10">₹</div>
              <p className="text-gray-500 text-xs">Click any node to inspect<br/>account or accused details</p>
            </div>
          )}
        </div>
      </div>

      {/* Money flow sankey by bank → district */}
      <div className="kv-card kv-card-hover p-5 animate-fade-up">
        <h2 className="kv-title mb-3">Money Flow by Bank → District (Laundering Indicator)</h2>
        <ReactECharts style={{height:320}} option={sankeyOption} />
      </div>

      <Callout tone="warning">
        Accounts with high suspicious-transaction counts relative to volume, or funnelling into a single district from
        multiple banks, are flagged as potential hawala/laundering indicators. Coordinate with FIU-IND for accounts exceeding ₹10L.
      </Callout>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex justify-between border-b border-[#2E2E2E]/40 pb-2">
      <span className="text-gray-500 uppercase tracking-wider text-[10px]">{label}</span>
      <span className="text-white font-bold">{value}</span>
    </div>
  )
}
