import { useState, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import { fetchSociological } from '../api.js'
import { PageHeader, Callout } from '../components/ui/Panel'

const DARK = { textStyle: { color: '#A1A1A1', fontFamily: 'monospace' }, backgroundColor: 'transparent' }

export default function Sociological() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSociological()
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const d = data || {}
  const gender = d.gender || {}
  const genderTotal = Object.values(gender).reduce((a,b) => a+b, 0) || 1

  const corr = d.correlations || {}
  const corrCards = [
    { label:'Age ↔ Risk Score',       value:corr.age_vs_risk,     detail:'Correlation between offender age and computed risk score' },
    { label:'Age ↔ Repeat Offending', value:corr.age_vs_repeat,   detail:'Whether younger offenders re-offend more often' },
    { label:'Risk ↔ Repeat Offending',value:corr.risk_vs_repeat,  detail:'Whether the risk model tracks actual recidivism' },
  ]

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">

      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Sociological Crime Insights"
        subtitle={loading ? 'Correlating socio-economic indicators…' : `${d.totalAccused || 0} accused profiled across age, gender, education, and economic status`}
      />

      {/* Correlation cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {corrCards.map((c, ci) => {
          const v = c.value ?? 0
          const strength = Math.abs(v)
          const color = strength > 0.5 ? '#F1493F' : strength > 0.25 ? '#F0A23D' : '#FFFFFF'
          return (
            <div key={c.label} className="kv-card kv-card-hover p-4 animate-fade-up" style={{ animationDelay: `${ci * 40}ms` }}>
              <p className="text-white text-[11px] font-bold mb-2">{c.label}</p>
              <p className="text-2xl font-black tabular-nums mb-1" style={{ color }}>{v > 0 ? '+' : ''}{v.toFixed(2)}</p>
              <div className="w-full bg-[#000000] h-1.5 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full" style={{ width:`${strength*100}%`, background:color }} />
              </div>
              <p className="text-gray-600 text-[10px] leading-relaxed">{c.detail}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Age × Crime heatmap */}
        <Panel title="Age Band × Crime Type Correlation Matrix">
          <ReactECharts style={{height:320}} option={{
            ...DARK,
            tooltip:{ position:'top' },
            grid:{ top:20, bottom:40, left:110, right:20 },
            xAxis:{ type:'category', data:d.ageBands||[], axisLabel:{ color:'#A1A1A1', fontSize:9 }, splitArea:{show:true} },
            yAxis:{ type:'category', data:d.crimes||[], axisLabel:{ color:'#A1A1A1', fontSize:9 }, splitArea:{show:true} },
            visualMap:{ min:0, max:20, calculable:true, orient:'horizontal', left:'center', bottom:0, textStyle:{color:'#A1A1A1'}, inRange:{color:['#0A0A0A','#60A5FA','#F1493F']} },
            series:[{ type:'heatmap', data:d.ageCrimeHeatmap||[], label:{show:true, color:'#FAFAFA', fontSize:9} }],
          }} />
        </Panel>

        {/* Gender pie */}
        <Panel title="Gender Distribution of Accused">
          <ReactECharts style={{height:320}} option={{
            ...DARK,
            tooltip:{ trigger:'item', formatter:'{b}: {c} ({d}%)' },
            legend:{ bottom:0, textStyle:{color:'#A1A1A1', fontSize:9} },
            series:[{
              type:'pie', radius:['35%','65%'],
              itemStyle:{ borderColor:'#0A0A0A', borderWidth:2 },
              label:{ color:'#A1A1A1', fontSize:10 },
              data:Object.entries(gender).map(([k,v]) => ({
                name:k, value:v, itemStyle:{ color: k==='Male'?'#60A5FA':k==='Female'?'#ec4899':'#A78BFA' },
              })),
            }],
          }} />
        </Panel>

        {/* Economic status vs risk/repeat */}
        <Panel title="Economic Status → Risk & Recidivism">
          <ReactECharts style={{height:300}} option={{
            ...DARK,
            tooltip:{ trigger:'axis' },
            legend:{ data:['Avg Risk Score','Repeat Rate %'], textStyle:{color:'#A1A1A1', fontSize:9}, top:0 },
            grid:{ top:40, bottom:30, left:35, right:20 },
            xAxis:{ type:'category', data:(d.economicRisk||[]).map(e=>e.label), axisLabel:{color:'#A1A1A1', fontSize:9} },
            yAxis:{ type:'value', axisLabel:{color:'#A1A1A1', fontSize:9}, splitLine:{lineStyle:{color:'#161616'}} },
            series:[
              { name:'Avg Risk Score', type:'bar', data:(d.economicRisk||[]).map(e=>e.avgRisk), itemStyle:{color:'#F1493F'}, barGap:'10%' },
              { name:'Repeat Rate %',  type:'bar', data:(d.economicRisk||[]).map(e=>e.repeatRate), itemStyle:{color:'#F0A23D'} },
            ],
          }} />
        </Panel>

        {/* Education vs risk */}
        <Panel title="Education Level → Avg Risk Score">
          <ReactECharts style={{height:300}} option={{
            ...DARK,
            tooltip:{ trigger:'axis' },
            grid:{ top:20, bottom:50, left:35, right:20 },
            xAxis:{ type:'category', data:(d.educationRisk||[]).map(e=>e.label), axisLabel:{color:'#A1A1A1', fontSize:8, rotate:20} },
            yAxis:{ type:'value', axisLabel:{color:'#A1A1A1', fontSize:9}, splitLine:{lineStyle:{color:'#161616'}} },
            series:[{
              type:'line', smooth:true, data:(d.educationRisk||[]).map(e=>e.avgRisk),
              lineStyle:{ color:'#FFFFFF', width:2 }, itemStyle:{ color:'#FFFFFF' },
              areaStyle:{ color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{offset:0,color:'rgba(91,192,190,0.35)'},{offset:1,color:'rgba(91,192,190,0)'}] } },
            }],
          }} />
        </Panel>

        {/* District density / urbanization proxy */}
        <Panel title="District Case Density (Urbanization Proxy)" span2>
          <ReactECharts style={{height:280}} option={{
            ...DARK,
            tooltip:{ trigger:'axis' },
            grid:{ top:20, bottom:60, left:45, right:20 },
            xAxis:{ type:'category', data:(d.districtDensity||[]).map(e=>e.district), axisLabel:{color:'#A1A1A1', fontSize:8, rotate:30} },
            yAxis:{ type:'value', axisLabel:{color:'#A1A1A1', fontSize:9}, splitLine:{lineStyle:{color:'#161616'}} },
            series:[{
              type:'bar', data:(d.districtDensity||[]).map(e=>e.count),
              itemStyle:{ color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{offset:0,color:'#FFFFFF'},{offset:1,color:'#262626'}] }, borderRadius:[4,4,0,0] },
            }],
          }} />
        </Panel>
      </div>

      <Callout tone="warning">
        Correlations are descriptive, not causal — they surface candidate social risk factors (economic stress, education,
        urban density) for investigator review, not automated decisions about individuals.
      </Callout>
    </div>
  )
}

function Panel({ title, children, span2 }) {
  return (
    <div className={`kv-card kv-card-hover p-5 animate-fade-up ${span2 ? 'md:col-span-2' : ''}`}>
      <h2 className="kv-title mb-3">{title}</h2>
      {children}
    </div>
  )
}
