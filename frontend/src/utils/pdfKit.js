import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// Shared branded PDF template — every export (Reports, Chat conversation,
// AI Briefing) uses this so downloads look like one consistent, designed
// document instead of a plain text dump. Print-oriented (white page, dark
// letterhead band) rather than matching the app's black theme, since a
// fully black page wastes ink and is hard to read on paper.

const INK        = '#0B0B0B'
const MUTED      = '#6B7280'
const ACCENT     = '#111111'
const RULE       = '#D8D8D8'
const PAGE_W     = 210
const MARGIN     = 14
const CONTENT_W  = PAGE_W - MARGIN * 2
const HEADER_H   = 30
const FOOTER_Y   = 287

// Vector KAVACH shield — drawn with jsPDF primitives (no image loading,
// always crisp), matching the same mark used for the browser favicon. Built
// from a lines() path (jsPDF has no native polygon primitive).
function shieldPath(doc, cx, topY, w, h, color) {
  const halfW = w / 2
  doc.setFillColor(...color)
  doc.setDrawColor(...color)
  const points = [
    [cx - halfW, topY],
    [cx + halfW, topY],
    [cx + halfW, topY + h * 0.55],
    [cx, topY + h],
    [cx - halfW, topY + h * 0.55],
  ]
  doc.lines(
    [
      [points[1][0]-points[0][0], points[1][1]-points[0][1]],
      [points[2][0]-points[1][0], points[2][1]-points[1][1]],
      [points[3][0]-points[2][0], points[3][1]-points[2][1]],
      [points[4][0]-points[3][0], points[4][1]-points[3][1]],
      [points[0][0]-points[4][0], points[0][1]-points[4][1]],
    ],
    points[0][0], points[0][1],
    [1, 1], 'F'
  )
}

function drawLogo(doc, x, y, size, onDark) {
  const fg = onDark ? [255,255,255] : [17,17,17]
  const bg = onDark ? [11,11,11] : [255,255,255]
  shieldPath(doc, x, y, size, size * 1.1, fg)
  doc.setFillColor(...bg)
  doc.circle(x, y + size * 0.52, size * 0.26, 'F')
  doc.setFillColor(...fg)
  doc.circle(x, y + size * 0.52, size * 0.09, 'F')
}

// Draws the letterhead band on the CURRENT page. Call once per page (first
// page + any continuation pages) so every sheet is identifiably KAVACH's.
function drawHeader(doc, { title, subtitle, meta }) {
  doc.setFillColor(10, 10, 10)
  doc.rect(0, 0, PAGE_W, HEADER_H, 'F')
  drawLogo(doc, MARGIN + 4, 8, 7, true)
  doc.setTextColor(255, 255, 255)
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(13)
  doc.text('KAVACH', MARGIN + 12, 12)
  doc.setFont('Helvetica', 'normal'); doc.setFontSize(7)
  doc.setTextColor(200, 200, 200)
  doc.text('KARNATAKA STATE POLICE · CRIME INTELLIGENCE PLATFORM', MARGIN + 12, 16.5)

  doc.setTextColor(255, 255, 255)
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(12)
  doc.text(title, MARGIN, HEADER_H - 6)
  if (subtitle) {
    doc.setFont('Helvetica', 'normal'); doc.setFontSize(8)
    doc.setTextColor(190, 190, 190)
    doc.text(subtitle, MARGIN, HEADER_H - 1.5)
  }
  if (meta) {
    doc.setFont('Helvetica', 'normal'); doc.setFontSize(7.5)
    doc.setTextColor(190, 190, 190)
    doc.text(meta, PAGE_W - MARGIN, HEADER_H - 1.5, { align: 'right' })
  }
  doc.setTextColor(0, 0, 0)
}

function drawFooter(doc, pageNum, totalPages) {
  doc.setDrawColor(...hexToRgb(RULE))
  doc.setLineWidth(0.2)
  doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y)
  doc.setFont('Helvetica', 'normal'); doc.setFontSize(7)
  doc.setTextColor(...hexToRgb(MUTED))
  doc.text('KAVACH Intelligence Platform · Karnataka State Police · CONFIDENTIAL', MARGIN, FOOTER_Y + 4)
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, FOOTER_Y + 4, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Creates a new branded document with the header already drawn on page 1.
// `headerInfo` is reused for every subsequent page added via addPage().
export function createReportDoc({ title, subtitle, meta }) {
  const doc = new jsPDF()
  drawHeader(doc, { title, subtitle, meta })
  return doc
}

// Call right before doc.save() — stamps the footer + page numbers on every
// page (must run last since page count isn't known until content is done).
export function finalizeDoc(doc, headerInfo) {
  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    if (p > 1) drawHeader(doc, { ...headerInfo, subtitle: `${headerInfo.subtitle || ''} (continued)`.trim() })
    drawFooter(doc, p, total)
  }
}

// Adds a section heading with a colored rule underneath — call before a
// paragraph or table. Returns the new y cursor.
export function sectionHeading(doc, text, y) {
  if (y > FOOTER_Y - 20) { doc.addPage(); y = HEADER_H + 10 }
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(10.5)
  doc.setTextColor(...hexToRgb(INK))
  doc.text(text.toUpperCase(), MARGIN, y)
  doc.setDrawColor(...hexToRgb(ACCENT))
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y + 1.5, MARGIN + 22, y + 1.5)
  return y + 8
}

// Renders **bold** markdown inline within wrapped paragraphs, returning the
// new y cursor. Handles page overflow by adding a fresh page automatically.
export function markdownParagraph(doc, raw, y, { fontSize = 9.5, lineHeight = 5.2 } = {}) {
  const text = String(raw || '')
  const paragraphs = text.split('\n').map(l => l.trim()).filter(Boolean)
  doc.setFontSize(fontSize)

  paragraphs.forEach(line => {
    const isBullet = /^[-•*]\s+/.test(line)
    const clean = line.replace(/^[-•*]\s+/, '')
    const segments = clean.split(/(\*\*.*?\*\*)/g).filter(s => s !== '')
    const xStart = MARGIN + (isBullet ? 4 : 0)
    const maxWidth = CONTENT_W - (isBullet ? 4 : 0)

    // Wrap by measuring segment-by-segment so bold runs stay bold across wraps
    let cursorX = xStart
    let cursorY = y
    if (isBullet) {
      if (cursorY > FOOTER_Y - 10) { doc.addPage(); cursorY = HEADER_H + 10 }
      doc.setFont('Helvetica', 'normal'); doc.setTextColor(...hexToRgb(INK))
      doc.text('•', MARGIN, cursorY)
    }
    const words = []
    segments.forEach(seg => {
      const bold = seg.startsWith('**') && seg.endsWith('**')
      const content = bold ? seg.slice(2, -2) : seg
      content.split(' ').forEach(w => { if (w) words.push({ w, bold }) })
    })

    words.forEach((wordObj, i) => {
      doc.setFont('Helvetica', wordObj.bold ? 'bold' : 'normal')
      const piece = wordObj.w + (i < words.length - 1 ? ' ' : '')
      const w = doc.getTextWidth(piece)
      if (cursorX + w > MARGIN + maxWidth) {
        cursorY += lineHeight
        cursorX = xStart
        if (cursorY > FOOTER_Y - 10) { doc.addPage(); cursorY = HEADER_H + 10 }
      }
      doc.setTextColor(...hexToRgb(INK))
      doc.text(piece, cursorX, cursorY)
      cursorX += w
    })
    y = cursorY + lineHeight + 1.5
  })
  return y
}

// Thin wrapper around jspdf-autotable with KAVACH's brand styling baked in.
export function brandedTable(doc, { head, body, startY, columnStyles }) {
  autoTable(doc, {
    head: [head],
    body,
    startY,
    margin: { left: MARGIN, right: MARGIN },
    styles: { font: 'Helvetica', fontSize: 8.5, cellPadding: 2.6, textColor: hexToRgb(INK), lineColor: hexToRgb(RULE), lineWidth: 0.15 },
    headStyles: { fillColor: [10, 10, 10], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [246, 246, 246] },
    columnStyles: columnStyles || {},
    didDrawPage: () => {}, // header/footer stamped once at the end via finalizeDoc
  })
  return doc.lastAutoTable.finalY + 8
}

export const PDF_LAYOUT = { MARGIN, CONTENT_W, HEADER_H, FOOTER_Y }
