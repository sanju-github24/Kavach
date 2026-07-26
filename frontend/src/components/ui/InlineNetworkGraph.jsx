import { useEffect, useMemo, useRef, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import { dataQuery } from '../../api.js'

const RISK_COLOR = { 'High Risk': '#F1493F', 'Medium Risk': '#F0A23D', 'Low Risk': '#2CB67D' }

const COSE_LAYOUT = {
  name: 'cose', animate: false, fit: true, padding: 20,
  nodeRepulsion: 300000, idealEdgeLength: 80, gravity: 60, numIter: 1500,
  tile: true, tilingPaddingVertical: 12, tilingPaddingHorizontal: 12,
}

const stylesheet = [
  { selector: 'node', style: {
    'background-color': '#000000', 'border-width': 2,
    'border-color': (el) => RISK_COLOR[el.data('group')] || '#707070',
    'label': 'data(label)', 'color': '#FAFAFA', 'font-size': 8, 'font-family': 'monospace',
    'text-valign': 'bottom', 'text-margin-y': 4, 'width': 24, 'height': 24,
  }},
  { selector: 'edge', style: {
    'width': 1.2, 'line-color': '#2E2E2E', 'curve-style': 'bezier', 'target-arrow-shape': 'none',
    'label': 'data(label)', 'font-size': 6, 'color': '#707070', 'font-family': 'monospace',
  }},
]

// Small, self-contained relationship graph rendered inline in a chat message
// — pulls the accused IDs the reply actually mentions (ACC-###) out of the
// text, then shows just that neighborhood of the real network, not the
// whole 1000+-node graph.
export default function InlineNetworkGraph({ text }) {
  const [net, setNet] = useState(null)
  const cyRef = useRef(null)

  const mentionedIds = useMemo(() => {
    const matches = [...(text || '').matchAll(/ACC-\d+/g)].map(m => m[0])
    return [...new Set(matches)]
  }, [text])

  useEffect(() => {
    if (!mentionedIds.length) return
    dataQuery('networks').then(setNet).catch(() => setNet(null))
  }, [mentionedIds.length])

  const elements = useMemo(() => {
    if (!net?.nodes?.length || !mentionedIds.length) return []
    const mentioned = new Set(mentionedIds)
    const neighborIds = new Set(mentioned)
    ;(net.links || []).forEach(l => {
      if (mentioned.has(l.source)) neighborIds.add(l.target)
      if (mentioned.has(l.target)) neighborIds.add(l.source)
    })
    const nodes = net.nodes.filter(n => neighborIds.has(n.id))
    const nodeIds = new Set(nodes.map(n => n.id))
    const links = (net.links || []).filter(l => nodeIds.has(l.source) && nodeIds.has(l.target))
    return [
      ...nodes.map(n => ({ data: { id: n.id, label: n.name.split(' ')[0], group: n.group } })),
      ...links.map((l, i) => ({ data: { id: `e${i}`, source: l.source, target: l.target, label: l.type } })),
    ]
  }, [net, mentionedIds])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !elements.length) return
    const id = requestAnimationFrame(() => cy.layout(COSE_LAYOUT).run())
    return () => cancelAnimationFrame(id)
  }, [elements])

  if (!mentionedIds.length || elements.length < 2) return null

  return (
    <div className="mt-3 border border-base-border rounded-xl overflow-hidden">
      <p className="text-[9px] text-ink-faint uppercase tracking-widest px-3 pt-2.5">Relationship map</p>
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        style={{ width: '100%', height: 160 }}
        layout={COSE_LAYOUT}
        cy={(cy) => { cyRef.current = cy }}
      />
    </div>
  )
}
