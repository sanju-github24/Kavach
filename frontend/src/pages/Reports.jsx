import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { fetchAnalytics, fetchProfiles, fetchForecast } from '../api.js'
import { useAuth } from '../contexts/AuthContext'
import { createReportDoc, finalizeDoc, sectionHeading, brandedTable } from '../utils/pdfKit.js'
import { buildReportHtml, serverPdf } from '../utils/reportHtml.js'
import { PageHeader, Callout } from '../components/ui/Panel'

const REPORT_TYPES = [
  { id:'district',   label:'District Crime Report',    desc:'Case volume, top crime type, and status breakdown per district' },
  { id:'officer',    label:'Officer / Case Report',     desc:'Repeat-offender roster with risk scores and linked FIR counts' },
  { id:'hotspot',    label:'Hotspot Intelligence Report', desc:'Predicted crime hotspots with risk scores and trend %' },
]

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function toCSV(rows, columns) {
  const header = columns.map(c => c.label).join(',')
  const body   = rows.map(r => columns.map(c => `"${String(r[c.key] ?? '').replace(/"/g,'""')}"`).join(',')).join('\n')
  return `${header}\n${body}`
}

export default function Reports() {
  const { user } = useAuth()
  const [analytics, setAnalytics] = useState(null)
  const [profiles, setProfiles]   = useState(null)
  const [forecast, setForecast]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState(null)

  useEffect(() => {
    Promise.all([fetchAnalytics(), fetchProfiles(), fetchForecast()])
      .then(([a, p, f]) => { setAnalytics(a); setProfiles(p); setForecast(f) })
      .finally(() => setLoading(false))
  }, [])

  const reportData = {
    district: {
      rows: analytics?.districts || [],
      columns: [
        { key:'name', label:'District' }, { key:'cases', label:'Total Cases' },
        { key:'top', label:'Top Crime Type' }, { key:'pct', label:'% of State Total' },
      ],
    },
    officer: {
      rows: profiles?.profiles || [],
      columns: [
        { key:'accused_id', label:'Accused ID' }, { key:'name', label:'Name' },
        { key:'district', label:'District' }, { key:'risk_score', label:'Risk Score' },
        { key:'primary_crime', label:'Primary Crime' }, { key:'fir_count', label:'Linked FIRs' },
      ],
    },
    hotspot: {
      rows: forecast?.hotspots || [],
      columns: [
        { key:'name', label:'Location' }, { key:'district', label:'District' },
        { key:'risk', label:'Risk Level' }, { key:'score', label:'Score' },
        { key:'trend', label:'Trend' }, { key:'predicted', label:'Predicted (72h)' },
      ],
    },
  }

  const exportCSV = (type) => {
    const { rows, columns } = reportData[type]
    downloadBlob(`KAVACH_${type}_report.csv`, toCSV(rows, columns), 'text/csv;charset=utf-8;')
  }

  const exportExcel = (type) => {
    const { rows, columns } = reportData[type]
    const sheetRows = rows.map(r => Object.fromEntries(columns.map(c => [c.label, r[c.key]])))
    const ws = XLSX.utils.json_to_sheet(sheetRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, type.slice(0, 30))
    XLSX.writeFile(wb, `KAVACH_${type}_report.xlsx`)
  }

  // Primary path: server-side SmartBrowz render from branded HTML. Falls back
  // to the local jsPDF build (exportPDFLocal) if SmartBrowz isn't available.
  const exportPDF = (type) => {
    const { rows, columns } = reportData[type]
    const meta = REPORT_TYPES.find(r => r.id === type)
    const html = buildReportHtml({
      title: meta.label,
      subtitle: `${rows.length} record(s) · Karnataka State Police`,
      meta: `Generated ${new Date().toLocaleString('en-IN')} · ${user?.firstName || 'Officer'}`,
      intro: `This report lists ${rows.length} record(s) as of ${new Date().toLocaleDateString('en-IN')}. Data is sourced live from the KAVACH Data Store.`,
      sections: [{
        heading: 'Detail',
        table: {
          head: columns.map(c => c.label),
          rows: rows.map(r => columns.map(c => r[c.key])),
        },
      }],
    })
    return serverPdf(html, `KAVACH_${type}_report.pdf`, () => exportPDFLocal(type))
  }

  const exportPDFLocal = (type) => {
    const { rows, columns } = reportData[type]
    const meta = REPORT_TYPES.find(r => r.id === type)
    const headerInfo = {
      title: meta.label,
      subtitle: `${rows.length} record(s) · Karnataka State Police`,
      meta: `Generated ${new Date().toLocaleString('en-IN')} · ${user?.firstName || 'Officer'} (${user?.role || 'investigator'})`,
    }
    const doc = createReportDoc(headerInfo)
    let y = 40
    y = sectionHeading(doc, 'Summary', y)
    doc.setFont('Helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40)
    doc.text(`This report lists ${rows.length} record(s) as of ${new Date().toLocaleDateString('en-IN')}. Data is sourced live from the KAVACH Data Store.`, 14, y)
    y += 10

    y = sectionHeading(doc, 'Detail', y)
    brandedTable(doc, {
      head: columns.map(c => c.label),
      body: rows.map(r => columns.map(c => {
        const v = r[c.key]
        return v === null || v === undefined || v === '' ? '—' : String(v)
      })),
      startY: y,
    })

    finalizeDoc(doc, headerInfo)
    doc.save(`KAVACH_${type}_report.pdf`)
  }

  const run = async (type, fmt) => {
    setBusy(`${type}-${fmt}`)
    try {
      if (fmt === 'csv') exportCSV(type)
      else if (fmt === 'excel') exportExcel(type)
      else await exportPDF(type)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-6 bg-[#000000] text-white min-h-full space-y-5 font-mono">
      <PageHeader
        eyebrow="Karnataka State Police · KAVACH"
        title="Intelligence Reporting"
        subtitle={loading ? 'Preparing report data…' : 'Export district, officer, and hotspot reports as CSV, Excel, or PDF'}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {REPORT_TYPES.map((rt, ri) => {
          const count = reportData[rt.id]?.rows?.length || 0
          return (
            <div key={rt.id} className="kv-card kv-card-hover p-5 flex flex-col animate-fade-up" style={{ animationDelay: `${ri * 40}ms` }}>
              <h2 className="text-white text-sm font-bold mb-1">{rt.label}</h2>
              <p className="text-gray-500 text-[11px] leading-relaxed mb-3 flex-1">{rt.desc}</p>
              <p className="text-[10px] text-[#FFFFFF] mb-4">{count} record(s) available</p>
              <div className="flex gap-2">
                {['csv','excel','pdf'].map(fmt => (
                  <button key={fmt} disabled={!count || busy === `${rt.id}-${fmt}`}
                    onClick={() => run(rt.id, fmt)}
                    className="flex-1 text-[10px] uppercase tracking-wider font-bold py-2 rounded-lg border border-[#2E2E2E] text-gray-300 hover:border-[#FFFFFF]/60 hover:text-[#FFFFFF] transition disabled:opacity-30 disabled:cursor-not-allowed">
                    {busy === `${rt.id}-${fmt}` ? '…' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <Callout tone="info">
        Reports are generated client-side from your current session data and exported directly to your browser downloads folder.
        Chat conversation history can be saved as PDF from the Conversational AI page.
      </Callout>
    </div>
  )
}
