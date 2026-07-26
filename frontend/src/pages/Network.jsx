import { useState, useEffect, useRef, useMemo } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import { dataQuery, getAccusedPhotosBulk } from '../api.js'
import AccusedAvatar from '../components/ui/AccusedAvatar'
import { PageHeader, KpiCard, Callout } from '../components/ui/Panel'
import { IconNode } from '../components/ui/Icons'
import { DEFAULT_AVATAR_DATA_URI } from '../components/ui/defaultAvatar'

// Empty shell shown only if the live Data Store is unreachable — no fake nodes.
// The graph, entities and financial links all come from the `networks` action.
const EMPTY_NETWORK = { nodes: [], links: [], financial: [] }

const RISK_COLOR  = { 'High Risk':'#F1493F', 'Medium Risk':'#F0A23D', 'Low Risk':'#2CB67D' }
const LINK_COLOR  = { 'CO-ACCUSED':'#FFFFFF', 'ASSOCIATE':'#A78BFA', 'FINANCIAL':'#F0A23D', 'LOCATION':'#2CB67D' }
const TABS        = ['graph','entities','financial']

export default function Network() {
  const [network,  setNetwork]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [tab,      setTab]      = useState('graph')
  const [search,   setSearch]   = useState('')
  const [riskFilter, setRiskFilter] = useState('All')
  const [connectedOnly, setConnectedOnly] = useState(true)
  const [photos, setPhotos] = useState({})
  const cyRef = useRef(null)

  const MAX_NODES = 250

  useEffect(() => {
    dataQuery('networks')
      .then(d  => { setNetwork(d?.nodes ? d : EMPTY_NETWORK); setLoading(false) })
      .catch(() => { setNetwork(EMPTY_NETWORK); setLoading(false) })
  }, [])

  // Bulk-fetch any attached photos once the entity list is known — a single
  // call rather than one per node/avatar.
  useEffect(() => {
    const ids = (network?.nodes || []).map(n => n.id)
    if (!ids.length) return
    getAccusedPhotosBulk(ids).then(d => setPhotos(d?.photos || {})).catch(() => {})
  }, [network])

  const net = network || EMPTY_NETWORK

  // IDs that appear in at least one relationship — most accused have zero
  // links, and graphing all of them alongside a sparse edge set is what was
  // causing everything to clump into one unreadable blob.
  const connectedIds = useMemo(() => {
    const ids = new Set()
    ;(net.links || []).forEach(l => { ids.add(l.source); ids.add(l.target) })
    return ids
  }, [net])

  // Build Cytoscape elements, applying search + risk filters
  const { elements, hiddenCount } = useMemo(() => {
    const isSearching = !!search
    let candidates = (net.nodes || []).filter(n =>
      (riskFilter === 'All' || n.group === riskFilter) &&
      (!search || n.name.toLowerCase().includes(search.toLowerCase()) || n.id.toLowerCase().includes(search.toLowerCase()))
    )
    if (connectedOnly && !isSearching) {
      candidates = candidates.filter(n => connectedIds.has(n.id))
    }
    // Degree-first ordering: when we truncate to MAX_NODES, this keeps a
    // node's actual connections in the visible set too, instead of picking
    // purely by risk and silently stranding half the edges.
    const degree = {}
    ;(net.links || []).forEach(l => { degree[l.source] = (degree[l.source]||0)+1; degree[l.target] = (degree[l.target]||0)+1 })
    const hidden = Math.max(0, candidates.length - MAX_NODES)
    const visibleNodes = [...candidates]
      .sort((a,b) => (degree[b.id]||0) - (degree[a.id]||0) || (b.risk||0) - (a.risk||0))
      .slice(0, MAX_NODES)
    const visibleIds = new Set(visibleNodes.map(n => n.id))
    const nodeEls = visibleNodes.map(n => ({
      data: { id: n.id, label: n.name.split(' ')[0], ...n, photoUrl: photos[n.id] || DEFAULT_AVATAR_DATA_URI },
      classes: n.group === 'High Risk' ? 'high-risk' : n.group === 'Medium Risk' ? 'medium-risk' : 'low-risk',
    }))
    const edgeEls = (net.links || [])
      .filter(l => visibleIds.has(l.source) && visibleIds.has(l.target))
      .map((l, i) => ({
        data: { id: `e${i}`, source: l.source, target: l.target, label: l.type },
        classes: l.type === 'FINANCIAL' ? 'financial-edge' : 'default-edge',
      }))
    return { elements: [...nodeEls, ...edgeEls], hiddenCount: hidden }
  }, [net, search, riskFilter, connectedOnly, connectedIds, photos])

  const COSE_LAYOUT = {
    name:'cose', animate:false, fit:true, padding:30,
    nodeRepulsion:450000, idealEdgeLength:110, nestingFactor:1.2,
    gravity:60, numIter:2000, tile:true, tilingPaddingVertical:20, tilingPaddingHorizontal:20,
    componentSpacing:120,
  }

  // react-cytoscapejs only applies the `layout` prop once, on mount — when
  // real data replaces the initial elements (async fetch), new nodes get
  // added at cytoscape's default position instead of being laid out, which
  // is what caused everything to render stacked in one spot. Re-running the
  // layout explicitly whenever the element set changes fixes that.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !elements.length) return
    const id = requestAnimationFrame(() => { cy.layout(COSE_LAYOUT).run() })
    return () => cancelAnimationFrame(id)
  }, [elements])

  const stylesheet = [
    { selector: 'node', style: {
      'background-color': '#111111', 'border-width': 3, 'border-color': (el)=>RISK_COLOR[el.data('group')]||'#707070',
      'background-image': 'data(photoUrl)', 'background-fit': 'cover', 'background-clip': 'node',
      'label': 'data(label)', 'color': '#FAFAFA', 'font-size': 9, 'font-family':'monospace',
      'text-valign': 'bottom', 'text-margin-y': 6, 'shape': 'ellipse',
      'width': (el)=> el.data('group')==='High Risk'?60:46, 'height': (el)=> el.data('group')==='High Risk'?60:46,
    }},
    { selector: '.high-risk',   style: { 'border-color': '#F1493F', 'background-color': '#F1493F22' } },
    { selector: '.medium-risk', style: { 'border-color': '#F0A23D', 'background-color': '#F0A23D18' } },
    { selector: '.low-risk',    style: { 'border-color': '#2CB67D', 'background-color': '#2CB67D18' } },
    { selector: 'node:selected', style: { 'border-color': '#ffffff', 'border-width': 3 } },
    { selector: 'edge', style: {
      'width': 1.5, 'line-color': '#2E2E2E', 'target-arrow-shape': 'none', 'curve-style': 'bezier',
      'label': 'data(label)', 'font-size': 7, 'color': '#FFFFFF', 'font-family':'monospace', 'text-rotation':'autorotate',
    }},
    { selector: '.financial-edge', style: { 'line-color': '#F0A23D', 'line-style': 'dashed', 'width': 2.5 } },
  ]

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      {/* Header */}
      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Criminal Network Analysis"
        subtitle={loading ? 'Loading network…' : `${net.nodes?.length} entities · ${net.links?.length} connections · ${net.financial?.length} flagged accounts`}
        right={
          <div className="flex gap-1">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider font-bold transition-all border ${
                  tab === t
                    ? 'bg-[#FFFFFF] text-[#000000] border-[#FFFFFF]'
                    : 'text-gray-500 border-[#2E2E2E] hover:text-[#FFFFFF] hover:border-[#FFFFFF]/40'
                }`}>{t}</button>
            ))}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'Total Entities',   value:net.nodes?.length||0,                                  color:'#FFFFFF' },
          { label:'High Risk',        value:net.nodes?.filter(n=>n.group==='High Risk').length||0,  color:'#F1493F' },
          { label:'Network Links',    value:net.links?.length||0,                                   color:'#A78BFA' },
          { label:'Flagged Accounts', value:net.financial?.length||0,                               color:'#F0A23D' },
        ].map((s, i) => (
          <KpiCard key={s.label} label={s.label} value={s.value} color={s.color} delay={i * 40} />
        ))}
      </div>

      {/* TAB: GRAPH */}
      {tab === 'graph' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 kv-card animate-fade-up overflow-hidden" style={{ height:520 }}>
            <div className="px-4 py-2.5 border-b border-[#2E2E2E] flex justify-between items-center flex-wrap gap-2">
              <span className="text-xs text-[#FFFFFF] font-bold uppercase tracking-wider">Network Graph — click node to inspect, scroll to zoom, drag to pan</span>
              <div className="flex gap-4 flex-wrap">
                {Object.entries(LINK_COLOR).map(([type, color]) => (
                  <span key={type} className="flex items-center gap-1.5 text-[9px] text-gray-500">
                    <span className="w-4 h-px inline-block" style={{ background:color }} />{type}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2E2E2E] bg-[#000000]/40">
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or ID…"
                className="flex-1 bg-[#000000] border border-[#2E2E2E] rounded px-3 py-1.5 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-[#FFFFFF]"
              />
              <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)}
                className="bg-[#000000] border border-[#2E2E2E] rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#FFFFFF]">
                {['All','High Risk','Medium Risk','Low Risk'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={() => setConnectedOnly(v => !v)}
                title="Isolated entities with no recorded links clutter the graph — hidden by default"
                className={`text-[10px] px-2 py-1.5 rounded border transition-colors ${connectedOnly ? 'border-white/40 text-white bg-white/10' : 'border-[#2E2E2E] text-gray-400 hover:text-white'}`}>
                Connected only
              </button>
              <button onClick={() => cyRef.current?.fit(undefined, 40)}
                className="text-[10px] px-2 py-1.5 rounded border border-[#2E2E2E] text-gray-400 hover:text-[#FFFFFF] hover:border-[#FFFFFF]/40">
                Fit
              </button>
            </div>
            {hiddenCount > 0 && (
              <div className="px-4 py-1.5 text-[10px] text-gray-500 border-b border-[#2E2E2E] bg-[#000000]/40">
                Showing top {MAX_NODES} of {MAX_NODES + hiddenCount} matching entities by risk — narrow with search or filters to see more.
              </div>
            )}
            <CytoscapeComponent
              elements={elements}
              stylesheet={stylesheet}
              style={{ width:'100%', height:'calc(100% - 84px)' }}
              layout={COSE_LAYOUT}
              cy={(cy) => {
                cyRef.current = cy
                cy.removeAllListeners()
                cy.on('tap', 'node', (evt) => setSelected(evt.target.data()))
                cy.on('tap', (evt) => { if (evt.target === cy) setSelected(null) })
              }}
            />
          </div>

          {/* Node detail */}
          <div className="kv-card animate-fade-up p-5 flex flex-col">
            {selected ? (
              <>
                <div className="flex justify-between items-start mb-5">
                  <div className="flex items-center gap-4">
                    <AccusedAvatar
                      accusedId={selected.id} name={selected.name} photoUrl={photos[selected.id]}
                      size={80} borderColor={RISK_COLOR[selected.group]||'#707070'} editable
                      onPhotoChange={(url) => setPhotos(p => ({ ...p, [selected.id]: url }))}
                    />
                    <div>
                      <h3 className="text-white font-black text-base">{selected.name}</h3>
                      <p className="text-[#FFFFFF] text-[10px] font-mono mt-0.5">{selected.id}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded border"
                    style={{ color:RISK_COLOR[selected.group], borderColor:RISK_COLOR[selected.group]+'40', background:RISK_COLOR[selected.group]+'10' }}>
                    {selected.group}
                  </span>
                </div>
                <div className="space-y-3 text-[11px]">
                  {[
                    { label:'Primary Crime',   value:selected.crime },
                    { label:'District',        value:selected.district },
                    { label:'Risk Score',      value:`${selected.risk}/100` },
                    { label:'Repeat Offender', value:selected.repeat ? 'YES' : 'No' },
                    { label:'Connections',     value:net.links?.filter(l=>l.source===selected.id||l.target===selected.id).length||0 },
                  ].map(f => (
                    <div key={f.label} className="flex justify-between border-b border-[#2E2E2E]/40 pb-2">
                      <span className="text-gray-500 uppercase tracking-wider text-[10px]">{f.label}</span>
                      <span className="text-white font-bold">{f.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5">
                  <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-2">Connected to</p>
                  <div className="space-y-1.5">
                    {net.links?.filter(l=>l.source===selected.id||l.target===selected.id).map((l, i) => {
                      const oid   = l.source===selected.id ? l.target : l.source
                      const other = net.nodes?.find(n=>n.id===oid)
                      return (
                        <div key={i} onClick={()=>setSelected(other)}
                          className="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-[#000000] transition">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background:LINK_COLOR[l.type]||'#707070' }} />
                          <span className="text-[10px] text-gray-300 flex-1">{other?.name||oid}</span>
                          <span className="text-[9px]" style={{ color:LINK_COLOR[l.type]||'#707070' }}>{l.type}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <IconNode className="w-14 h-14 mb-4 opacity-15 text-white" />
                <p className="text-gray-500 text-xs">Click any node in the graph<br/>to inspect entity details</p>
                <div className="mt-8 space-y-2 w-full">
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-3">Risk legend</p>
                  {Object.entries(RISK_COLOR).map(([g,c]) => (
                    <div key={g} className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background:c }} />
                      <span className="text-[10px] text-gray-500">{g}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: ENTITIES */}
      {tab === 'entities' && (
        <div className="kv-card animate-fade-up overflow-hidden">
          <div className="px-5 py-3 border-b border-[#2E2E2E]">
            <h2 className="kv-title">Monitored Entities</h2>
          </div>
          <div className="divide-y divide-[#2E2E2E]/30">
            {net.nodes?.map(node => (
              <div key={node.id} onClick={() => { setSelected(node); setTab('graph') }}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#000000]/60 transition cursor-pointer group">
                <AccusedAvatar
                  accusedId={node.id} name={node.name} photoUrl={photos[node.id]}
                  size={52} borderColor={RISK_COLOR[node.group]||'#707070'} editable
                  onPhotoChange={(url) => setPhotos(p => ({ ...p, [node.id]: url }))}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold group-hover:text-[#FFFFFF] transition">{node.name}</p>
                  <p className="text-gray-500 text-[10px] font-mono">{node.id} · risk {node.risk} · {node.crime} · {node.district}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {node.repeat && (
                    <span className="text-[9px] bg-red-950 text-red-400 border border-red-800 px-1.5 py-0.5 rounded font-bold">REPEAT</span>
                  )}
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded border"
                    style={{ color:RISK_COLOR[node.group], borderColor:RISK_COLOR[node.group]+'40' }}>
                    {node.group}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: FINANCIAL */}
      {tab === 'financial' && (
        <div className="space-y-4">
          <div className="kv-card animate-fade-up overflow-hidden">
            <div className="px-5 py-3 border-b border-[#2E2E2E]">
              <h2 className="kv-title">Flagged Financial Accounts</h2>
            </div>
            {net.financial?.length ? (
              <div className="divide-y divide-[#2E2E2E]/30">
                {net.financial.map((f, i) => (
                  <div key={i} className="px-5 py-4 flex items-center gap-4 hover:bg-[#000000]/50 transition">
                    <div className="w-9 h-9 rounded-xl bg-amber-950/50 border border-amber-800/50 flex items-center justify-center text-amber-400 text-xs font-black flex-shrink-0">₹</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-bold">{f.account}</p>
                      <p className="text-gray-500 text-[10px] font-mono">{f.bank} · linked to {f.accused}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-amber-400 font-black">₹{Number(f.amount).toLocaleString('en-IN')}</p>
                      <p className="text-gray-500 text-[10px]">{f.txns} suspicious txns</p>
                    </div>
                    <span className="text-[9px] bg-red-950 text-red-400 border border-red-800 px-2 py-1 rounded font-bold flex-shrink-0">FLAGGED</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-gray-600 text-xs">No flagged accounts in Data Store</div>
            )}
          </div>

          <Callout tone="warning">
            Flagged accounts indicate suspicious transaction patterns from the FinancialAccounts table.
            Coordinate with ED and FIU-IND for accounts exceeding ₹10L in suspicious transactions.
          </Callout>
        </div>
      )}
    </div>
  )
}