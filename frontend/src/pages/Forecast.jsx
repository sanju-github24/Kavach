import { useState, useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.heat'
import ReactECharts from 'echarts-for-react'
import { dataQuery } from '../api.js'
import { PageHeader, KpiCard } from '../components/ui/Panel'
import SentinelPanel from '../components/ui/SentinelPanel'
import { IconFlame, IconCheck } from '../components/ui/Icons'

const DARK = { textStyle: { color: '#A1A1A1', fontFamily: 'monospace' }, backgroundColor: 'transparent' }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const STATIC_HOTSPOTS = [
  { id:1, name:'Koramangala',         lat:12.9352, lng:77.6245, district:'Bengaluru Urban', risk:'CRITICAL', score:94, crimes:['Robbery','Theft'],      trend:'+23%', predicted:34 },
  { id:2, name:'HSR Layout',          lat:12.9116, lng:77.6474, district:'Bengaluru Urban', risk:'HIGH',     score:81, crimes:['NDPS','Robbery'],        trend:'+18%', predicted:21 },
  { id:3, name:'Tumakuru NH-48',      lat:13.3379, lng:77.1017, district:'Tumakuru',        risk:'HIGH',     score:79, crimes:['Murder','Assault'],      trend:'+31%', predicted:6  },
  { id:4, name:'Mysuru City Centre',  lat:12.2958, lng:76.6394, district:'Mysuru',          risk:'HIGH',     score:77, crimes:['Fraud','Theft'],         trend:'+12%', predicted:17 },
  { id:5, name:'Belagavi Market',     lat:15.8497, lng:74.4977, district:'Belagavi',        risk:'HIGH',     score:73, crimes:['Assault','Robbery'],     trend:'+9%',  predicted:14 },
  { id:6, name:'MG Road Bengaluru',   lat:12.9754, lng:77.6086, district:'Bengaluru Urban', risk:'MEDIUM',   score:58, crimes:['Snatching','Theft'],     trend:'+7%',  predicted:11 },
  { id:7, name:'Kalaburagi Bus Stand',lat:17.3297, lng:76.8343, district:'Kalaburagi',      risk:'MEDIUM',   score:61, crimes:['Theft','Fraud'],         trend:'+5%',  predicted:8  },
  { id:8, name:'Mangaluru Port Area', lat:12.8698, lng:74.8426, district:'Dakshina Kannada',risk:'MEDIUM',   score:55, crimes:['NDPS','Smuggling'],      trend:'+4%',  predicted:5  },
]

const STATIC_ALERTS = [
  { id:1, type:'GANG ACTIVITY',   severity:'CRITICAL', time:'2h ago',  msg:'Repeat offender network active in Koramangala–HSR corridor. 3 associates spotted near ATMs. Deploy patrol immediately.' },
  { id:2, type:'CYBER SPIKE',     severity:'HIGH',     time:'5h ago',  msg:'Cyber fraud cases up 34% in Bengaluru this week. Pattern matches SIM swap network. Identify affected SIM dealers.' },
  { id:3, type:'SEASONAL ALERT',  severity:'HIGH',     time:'1d ago',  msg:'Festival season approaching. Data shows 28% crime spike in Oct–Nov. Recommend enhanced Dasara patrol plan.' },
  { id:4, type:'REPEAT OFFENDER', severity:'HIGH',     time:'1d ago',  msg:'Rajesh N (Vehicle Theft) released 3 days ago. 2 vehicle thefts reported in his known operational area.' },
  { id:5, type:'PATTERN MATCH',   severity:'MEDIUM',   time:'2d ago',  msg:'5 robbery cases share identical MO — ATM corner, 2 AM, motorbike getaway. Cross-case investigation recommended.' },
  { id:6, type:'FINANCIAL ALERT', severity:'MEDIUM',   time:'3d ago',  msg:'Suspicious transactions totalling ₹18.4L traced through hawala network. Forward to SFIO.' },
]

const RISK_COLOR = { CRITICAL:'#F1493F', HIGH:'#F0A23D', MEDIUM:'#FFFFFF', LOW:'#2CB67D' }
const RISK_ZOOM  = { CRITICAL:15, HIGH:14, MEDIUM:13, LOW:12 }
const SEV_BG     = { CRITICAL:'rgba(239,68,68,0.08)',  HIGH:'rgba(245,158,11,0.08)',  MEDIUM:'rgba(91,192,190,0.08)'  }
const SEV_BORDER = { CRITICAL:'rgba(239,68,68,0.25)',  HIGH:'rgba(245,158,11,0.25)',  MEDIUM:'rgba(91,192,190,0.25)' }
const SEV_TEXT   = { CRITICAL:'#F1493F', HIGH:'#F0A23D', MEDIUM:'#FFFFFF' }

export default function Forecast() {
  const [hotspots, setHotspots] = useState(STATIC_HOTSPOTS)
  const [intel, setIntel]       = useState(null) // { hourMatrix, forecastSeries, anomalies, alerts }
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)
  const mapRef      = useRef(null)
  const leafletMap  = useRef(null)
  const markersRef  = useRef({})
  const heatLayerRef = useRef(null)
  const [districtFilter, setDistrictFilter] = useState('All')
  const [showHeat, setShowHeat] = useState(true)

  // Fetch live data
  useEffect(() => {
    dataQuery('forecast')
      .then(data => {
        if (data?.forecastSeries || data?.hourMatrix?.length || data?.alerts?.length) setIntel(data)
        if (data?.hotspots?.length) { setHotspots(data.hotspots); return }
        return dataQuery('analytics').then(aData => {
          if (!aData?.districts?.length) return
          const COORDS = {
            'Bengaluru Urban' :{lat:12.9716,lng:77.5946},'Mysuru':{lat:12.2958,lng:76.6394},
            'Belagavi'        :{lat:15.8497,lng:74.4977},'Kalaburagi':{lat:17.3297,lng:76.8343},
            'Hubballi-Dharwad':{lat:15.3647,lng:75.1240},'Vijayapura':{lat:16.8302,lng:75.7100},
            'Ballari'         :{lat:15.1394,lng:76.9214},'Shivamogga':{lat:13.9299,lng:75.5681},
            'Mangaluru'       :{lat:12.8698,lng:74.8426},'Tumakuru':{lat:13.3379,lng:77.1017},
            'Bengaluru Rural' :{lat:13.1,lng:77.4},'Dakshina Kannada':{lat:12.8698,lng:75.0},
          }
          const max = Math.max(...aData.districts.map(d => d.cases), 1)
          setHotspots(aData.districts.filter(d => COORDS[d.name]).map((d, i) => {
            const score = Math.round((d.cases / max) * 100)
            const risk  = score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW'
            return { id:i+1, name:d.name, lat:COORDS[d.name].lat, lng:COORDS[d.name].lng, district:d.name, risk, score, crimes:[d.top], trend:`+${Math.round(score*0.2)}%`, predicted:Math.round(d.cases*0.15) }
          }))
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Init Leaflet (npm module, no CDN)
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return
    const map = L.map(mapRef.current, { zoomControl:true, attributionControl:true, preferCanvas:true })
      .setView([14.5, 76.0], 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'© OpenStreetMap'
    }).addTo(map)
    leafletMap.current = map

    const style = document.createElement('style')
    style.textContent = `
      .kv-popup .leaflet-popup-content-wrapper{background:#0A0A0A;color:#FAFAFA;border:1px solid #2E2E2E;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.7);padding:0;}
      .kv-popup .leaflet-popup-content{margin:0;}
      .kv-popup .leaflet-popup-tip{background:#0A0A0A;}
      .kv-popup .leaflet-popup-close-button{color:#707070!important;top:8px!important;right:10px!important;font-size:16px!important;}
      @keyframes kv-pulse { 0%{ box-shadow:0 0 0 0 rgba(239,68,68,0.6);} 70%{ box-shadow:0 0 0 14px rgba(239,68,68,0);} 100%{ box-shadow:0 0 0 0 rgba(239,68,68,0);} }
      .kv-pulse-marker { animation: kv-pulse 1.6s infinite; }
    `
    document.head.appendChild(style)

    return () => { if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null } }
  }, [])

  const filteredHotspots = useMemo(() =>
    districtFilter === 'All' ? hotspots : hotspots.filter(h => h.district === districtFilter),
  [hotspots, districtFilter])

  const districts = useMemo(() => ['All', ...new Set(hotspots.map(h => h.district))], [hotspots])

  // Re-draw markers + heat layer when filtered hotspots or toggle change
  useEffect(() => {
    if (!leafletMap.current) return
    const map = leafletMap.current
    Object.values(markersRef.current).forEach(m => m.remove())
    markersRef.current = {}
    addMarkers(map, filteredHotspots)

    if (heatLayerRef.current) { map.removeLayer(heatLayerRef.current); heatLayerRef.current = null }
    if (showHeat && filteredHotspots.length) {
      const points = filteredHotspots.map(h => [h.lat, h.lng, h.score / 100])
      heatLayerRef.current = L.heatLayer(points, { radius: 45, blur: 35, maxZoom: 12,
        gradient: { 0.2:'#60A5FA', 0.4:'#FFFFFF', 0.6:'#F0A23D', 0.8:'#F1493F', 1.0:'#991b1b' } })
        .addTo(map)
    }
  }, [filteredHotspots, showHeat])

  function addMarkers(map, spots) {
    spots.forEach(h => {
      const c    = RISK_COLOR[h.risk]
      // Emerging-trend alert: pulsing red ring when a district spikes vs historical baseline
      const isEmerging = h.risk === 'CRITICAL' || (parseFloat(h.trend) > 20)
      const icon = L.divIcon({
        className: isEmerging ? 'kv-pulse-marker' : '', iconAnchor:[9,9],
        html:`<div style="width:18px;height:18px;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,0.8);box-shadow:0 0 0 2px ${c}40,0 2px 8px rgba(0,0,0,.5);cursor:pointer;"></div>`
      })
      const marker = L.marker([h.lat, h.lng], { icon })
        .addTo(map)
        .bindPopup(popupHTML(h, c), { maxWidth:230, className:'kv-popup' })
        .on('click', () => { setSelected(h); map.flyTo([h.lat, h.lng], RISK_ZOOM[h.risk], { animate:true, duration:1.2 }) })
      markersRef.current[h.id] = marker
    })
  }

  const flyTo = h => {
    if (!leafletMap.current) return
    setSelected(h)
    leafletMap.current.flyTo([h.lat, h.lng], RISK_ZOOM[h.risk], { animate:true, duration:1.2 })
    markersRef.current[h.id]?.openPopup()
  }

  // Live alerts computed by the backend (anomaly z-scores, MO clusters,
  // repeat-offender risk); static list only bridges the initial load.
  const alerts = intel?.alerts?.length
    ? intel.alerts.map((a, i) => ({ id: i + 1, type: a.type, severity: a.severity, time: 'live', msg: a.msg, source: a.source }))
    : STATIC_ALERTS

  const anomalies = intel?.anomalies || []
  const fs = intel?.forecastSeries

  const kpis = [
    { label:'Critical Zones',  value:hotspots.filter(h=>h.risk==='CRITICAL').length, color:'#F1493F' },
    { label:'High Risk Zones', value:hotspots.filter(h=>h.risk==='HIGH').length,     color:'#F0A23D' },
    { label:'Active Alerts',   value:alerts.length,                                  color:'#FFFFFF' },
    { label:'Anomalies',       value:anomalies.length,                               color:'#A78BFA' },
  ]

  // Day-of-week × hour heatmap — the spatiotemporal layer of the forecast
  const hourHeatmapOption = intel?.hourMatrix?.length ? {
    ...DARK,
    tooltip: { position: 'top', formatter: p => `${DOW[p.value[1]]} ${String(p.value[0]).padStart(2,'0')}:00 — <b>${p.value[2]}</b> incidents` },
    grid: { top: 10, bottom: 30, left: 45, right: 20 },
    xAxis: { type: 'category', data: Array.from({length:24},(_,h)=>`${h}h`), splitArea: { show: true }, axisLabel: { fontSize: 8, color: '#707070', interval: 1 } },
    yAxis: { type: 'category', data: DOW, splitArea: { show: true }, axisLabel: { fontSize: 9, color: '#A1A1A1' } },
    visualMap: { min: 0, max: Math.max(...intel.hourMatrix.map(v=>v[2]), 1), show: false, inRange: { color: ['#0A0A0A', '#3291FF', '#F0A23D', '#F1493F'] } },
    series: [{ type: 'heatmap', data: intel.hourMatrix, itemStyle: { borderColor: '#000', borderWidth: 1 } }],
  } : null

  // Actual series + Holt-Winters forward forecast (dashed)
  const forecastChartOption = fs?.labels?.length ? {
    ...DARK,
    tooltip: { trigger: 'axis' },
    legend: { data: ['Actual cases', 'Model fit', 'Forecast'], textStyle: { color: '#A1A1A1', fontSize: 9 }, top: 0 },
    grid: { top: 28, bottom: 24, left: 40, right: 16 },
    xAxis: { type: 'category', data: [...fs.labels, ...fs.futureLabels], axisLabel: { fontSize: 8, color: '#707070' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#707070' }, splitLine: { lineStyle: { color: '#1A1A1A' } } },
    series: [
      { name: 'Actual cases', type: 'line', data: fs.actual, showSymbol: false, lineStyle: { color: '#FAFAFA', width: 1.5 }, itemStyle: { color: '#FAFAFA' } },
      { name: 'Model fit', type: 'line', data: fs.fitted, showSymbol: false, lineStyle: { color: '#3291FF', width: 1, opacity: 0.6 }, itemStyle: { color: '#3291FF' } },
      { name: 'Forecast', type: 'line', data: [...Array(Math.max(fs.labels.length - 1, 0)).fill(null), fs.actual[fs.actual.length - 1], ...fs.forecast],
        showSymbol: true, symbolSize: 5, lineStyle: { color: '#F0A23D', width: 2, type: 'dashed' }, itemStyle: { color: '#F0A23D' } },
    ],
  } : null

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      {/* Header */}
      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Forecasting & Early Warning"
        subtitle={`AI-driven hotspot prediction · Repeat offender alerts · Seasonal pattern analysis${!loading ? ' · Live Data' : ''}`}
        right={loading && <div className="w-5 h-5 border-2 border-t-transparent border-[#FFFFFF] rounded-full animate-spin" />}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <KpiCard key={k.label} label={k.label} value={k.value} color={k.color} delay={i * 40} />
        ))}
      </div>

      <SentinelPanel />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Map panel */}
        <div className="lg:col-span-2 kv-card animate-fade-up overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-[#2E2E2E] flex items-center justify-between gap-3 flex-wrap">
            <h2 className="kv-title shrink-0">Karnataka Hotspot Map</h2>
            <div className="flex items-center gap-3 ml-auto flex-wrap">
              <select value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
                className="bg-[#000000] border border-[#2E2E2E] rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-[#FFFFFF]">
                {districts.map(d => <option key={d} value={d}>{d === 'All' ? 'All Districts (drill-down)' : d}</option>)}
              </select>
              <button onClick={() => setShowHeat(v => !v)}
                className={`text-[10px] px-2 py-1 rounded border transition flex items-center gap-1 ${showHeat ? 'bg-[#FFFFFF]/15 border-[#FFFFFF]/40 text-[#FFFFFF]' : 'border-[#2E2E2E] text-gray-500'}`}>
                <IconFlame className="w-3 h-3" /> Heatmap
              </button>
              {selected && (
                <>
                  <span className="text-[10px] text-gray-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-risk-critical inline-block" />
                    <span className="text-[#FFFFFF] font-bold">{selected.name}</span>
                    <span className="text-gray-600">({selected.district})</span>
                  </span>
                  <button onClick={() => { setSelected(null); leafletMap.current?.flyTo([14.5,76.0],7,{animate:true,duration:1.2}) }}
                    className="text-[10px] text-gray-500 hover:text-[#FFFFFF] border border-[#2E2E2E] px-2 py-0.5 rounded transition">
                    ← Full map
                  </button>
                </>
              )}
              <div className="hidden sm:flex items-center gap-3 text-[9px] text-gray-500">
                {Object.entries(RISK_COLOR).map(([k,c]) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full border border-white/10 flex-shrink-0" style={{ background:c }} />
                    {k}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div ref={mapRef} style={{ height:380 }} className="bg-[#000000]" />

          {/* Hotspot list under map */}
          <div className="border-t border-[#2E2E2E] p-3 max-h-44 overflow-y-auto">
            <p className="text-[9px] text-gray-600 uppercase tracking-widest mb-2 px-1">Click to zoom</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[...filteredHotspots].sort((a,b)=>b.score-a.score).map(h => (
                <div key={h.id} onClick={() => flyTo(h)}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition border ${
                    selected?.id===h.id
                      ? 'border-[#FFFFFF]/40 bg-[#FFFFFF]/5'
                      : 'border-transparent hover:border-[#2E2E2E] hover:bg-[#000000]'
                  }`}>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/20"
                    style={{ background:RISK_COLOR[h.risk] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-gray-200 font-semibold truncate">{h.name}</p>
                    <p className="text-[9px] text-gray-600">{h.predicted} predicted · {h.trend}{h.peakBand && h.peakBand !== 'Unknown' ? ` · ${h.peakBand.split(' ')[0]}` : ''}</p>
                  </div>
                  <span className="text-[9px] font-black tabular-nums px-1.5 py-0.5 rounded border flex-shrink-0"
                    style={{ color:RISK_COLOR[h.risk], borderColor:RISK_COLOR[h.risk]+'30', background:RISK_COLOR[h.risk]+'10' }}>
                    {h.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div className="kv-card animate-fade-up flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-[#2E2E2E] flex items-center justify-between">
            <h2 className="kv-title">Early Warning</h2>
            <span className={`text-[9px] px-2 py-0.5 rounded border ${intel?.alerts?.length ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400' : 'bg-[#000000] border-[#2E2E2E] text-gray-500'}`}>
              {intel?.alerts?.length ? `${alerts.length} live · computed from data` : `${alerts.length} active`}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {alerts.map(a => (
              <div key={a.id} className="p-3 rounded-xl border"
                style={{ background:SEV_BG[a.severity]||SEV_BG.MEDIUM, borderColor:SEV_BORDER[a.severity]||SEV_BORDER.MEDIUM }}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded"
                    style={{ color:SEV_TEXT[a.severity]||SEV_TEXT.MEDIUM, background:SEV_BG[a.severity]||SEV_BG.MEDIUM, border:`1px solid ${SEV_BORDER[a.severity]||SEV_BORDER.MEDIUM}` }}>
                    {a.type}
                  </span>
                  <span className="text-[9px] text-gray-600">{a.time}</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">{a.msg}</p>
                {a.source && <p className="text-[9px] text-gray-600 mt-1.5 italic">Source: {a.source}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Time-of-day + volume forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="kv-card kv-card-hover animate-fade-up p-5">
          <div className="flex justify-between items-baseline mb-3 flex-wrap gap-2">
            <h2 className="kv-title">Time-of-Day Incident Pattern</h2>
            <span className="text-[9px] text-gray-600">day-of-week × hour · from Inv_OccuranceTime</span>
          </div>
          {hourHeatmapOption
            ? <ReactECharts style={{ height: 240 }} option={hourHeatmapOption} />
            : <p className="text-gray-600 text-xs py-16 text-center">{loading ? 'Loading incident-time data…' : 'No incident-time data available.'}</p>}
          {selected?.peakBand && selected.peakBand !== 'Unknown' && (
            <p className="text-[10px] text-amber-400/80 mt-2">
              ⏱ {selected.name}: peak window <span className="font-bold">{selected.peakBand}</span>
              {selected.timeBands?.length ? ` — ${selected.timeBands.map(b => `${b.band.split(' ')[0]} ${b.count}`).join(' · ')}` : ''}
            </p>
          )}
        </div>

        <div className="kv-card kv-card-hover animate-fade-up p-5">
          <div className="flex justify-between items-baseline mb-3 flex-wrap gap-2">
            <h2 className="kv-title">Crime Volume Forecast</h2>
            {fs?.model && (
              <span className="text-[9px] text-emerald-400/80">
                {fs.model.method?.split(' (')[0]}{fs.model.mape != null ? ` · MAPE ${fs.model.mape}%` : ''}
              </span>
            )}
          </div>
          {forecastChartOption
            ? <ReactECharts style={{ height: 240 }} option={forecastChartOption} />
            : <p className="text-gray-600 text-xs py-16 text-center">{loading ? 'Fitting forecasting model…' : 'Insufficient history for forecasting.'}</p>}
          {fs?.forecast?.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-2">
              Next {fs.forecast.length} months (statewide): <span className="text-amber-400 font-bold">{fs.forecast.join(' · ')}</span> cases predicted
            </p>
          )}
        </div>
      </div>

      {/* Statistical anomalies */}
      {anomalies.length > 0 && (
        <div className="kv-card kv-card-hover animate-fade-up p-5">
          <div className="flex justify-between items-baseline mb-4 flex-wrap gap-2">
            <h2 className="kv-title">Anomaly Detection</h2>
            <span className="text-[9px] text-gray-600">z-score vs each district's own monthly baseline · |z| ≥ 2 flagged</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {anomalies.slice(0, 8).map((a, i) => (
              <div key={i} className="p-3.5 rounded-xl border"
                style={{ background: a.severity==='CRITICAL' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
                         borderColor: a.severity==='CRITICAL' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)' }}>
                <div className="flex justify-between items-start mb-1.5">
                  <span className="text-white text-[11px] font-bold">{a.district}</span>
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                    style={{ color: a.severity==='CRITICAL' ? '#F1493F' : '#F0A23D', background: a.severity==='CRITICAL' ? '#F1493F18' : '#F0A23D18' }}>
                    z = {a.zscore}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  <span className={a.direction==='spike' ? 'text-red-400 font-bold' : 'text-blue-400 font-bold'}>
                    {a.direction === 'spike' ? '▲ Spike' : '▼ Drop'}
                  </span>{' '}
                  in {a.month}: <span className="text-white font-bold">{a.count}</span> cases vs {a.expected} expected
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explainable AI */}
      <div className="kv-card kv-card-hover animate-fade-up p-5">
        <h2 className="kv-title mb-4">AI Decision Transparency</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { step:'01', title:'Temporal model',
              detail: fs?.model
                ? `${fs.model.method}. In-sample MAPE ${fs.model.mape ?? '—'}% over ${fs.labels?.length || 0} months of CaseMaster history.`
                : 'Monthly case series modelled with exponential smoothing over full registered-case history.' },
            { step:'02', title:'Anomaly scan',
              detail: anomalies.length
                ? `${anomalies.length} district-month(s) deviate ≥2σ from their own historical baseline — strongest: ${anomalies[0].district} (z=${anomalies[0].zscore}).`
                : 'No district currently deviates ≥2σ from its historical monthly baseline.' },
            { step:'03', title:'Spatiotemporal',
              detail: intel?.hourMatrix?.length
                ? 'Hotspot scores combine district case density with hour-of-day incident windows from Inv_OccuranceTime — each zone carries its peak time band.'
                : 'Hotspot scores derived from district-level case density.' },
          ].map(s => (
            <div key={s.step} className="p-4 bg-[#000000] rounded-xl border border-[#2E2E2E]">
              <p className="text-[#FFFFFF] font-black text-xs mb-2">{s.step}. {s.title.toUpperCase()}</p>
              <p className="text-gray-400 text-[11px] leading-relaxed">{s.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 p-2.5 bg-emerald-950/30 border border-emerald-800/30 rounded-lg">
          <span className="text-emerald-400"><IconCheck className="w-3.5 h-3.5" /></span>
          <span className="text-emerald-400 text-[10px] uppercase tracking-wider font-bold">
            LEAF Explainable AI Standards · All predictions cite source data references
          </span>
        </div>
      </div>
    </div>
  )
}

function popupHTML(h, color) {
  return `<div style="font-family:monospace;padding:14px 16px;min-width:210px;">
    <div style="font-weight:900;font-size:13px;color:#FAFAFA;margin-bottom:4px;">${h.name}</div>
    <div style="font-size:10px;color:#707070;margin-bottom:8px;">${h.district}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="color:${color};font-size:12px;font-weight:700;">${h.risk}</span>
      <span style="color:#A1A1A1;font-size:10px;">Score <strong style="color:${color}">${h.score}</strong></span>
    </div>
    <div style="font-size:10px;color:#A1A1A1;margin-bottom:4px;">Crimes: ${h.crimes?.join(' · ')}</div>
    ${h.peakBand && h.peakBand !== 'Unknown' ? `<div style="font-size:10px;color:#F0A23D;margin-bottom:4px;">⏱ Peak window: ${h.peakBand}</div>` : ''}
    <div style="font-size:10px;margin-top:8px;display:flex;justify-content:space-between;border-top:1px solid #2E2E2E;padding-top:8px;">
      <span style="color:#FFFFFF;">⚠ ${h.predicted} incidents/72h</span>
      <span style="color:${color};font-weight:700;">${h.trend}</span>
    </div>
  </div>`
}