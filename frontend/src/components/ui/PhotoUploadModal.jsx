import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../contexts/AuthContext'
import { setAccusedPhoto, deleteAccusedPhoto } from '../../api.js'

const MAX_DIM = 320

// Resizes/compresses the picked image client-side before it ever reaches the
// network — keeps the base64 payload well under the TEXT column's practical
// limit and avoids uploading multi-MB phone-camera photos for a headshot.
function resizeToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        let { width, height } = img
        const scale = Math.min(1, MAX_DIM / Math.max(width, height))
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function DefaultSilhouette({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#555" strokeWidth="1.5">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" />
    </svg>
  )
}

export default function PhotoUploadModal({ accusedId, name, currentPhoto, onClose, onSaved }) {
  const { user } = useAuth()
  const [preview, setPreview] = useState(currentPhoto || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return }
    setError(null)
    try { setPreview(await resizeToDataUrl(file)) }
    catch { setError('Could not read that image — try a different file.') }
  }

  const save = async () => {
    if (!preview || preview === currentPhoto) { onClose(); return }
    setBusy(true); setError(null)
    try {
      const res = await setAccusedPhoto(accusedId, preview, user?.id)
      if (res?.error) setError(res.error)
      else onSaved(preview)
    } catch { setError('Upload failed — check backend connection.') }
    setBusy(false)
  }

  const remove = async () => {
    setBusy(true); setError(null)
    try { await deleteAccusedPhoto(accusedId, user?.id); onSaved(null) }
    catch { setError('Could not remove photo — check backend connection.') }
    setBusy(false)
  }

  // Rendered through a portal to <body>. The cards this modal is launched from
  // carry `animate-fade-up`, whose `both` fill-mode leaves a transform on the
  // element after the animation ends — and a transformed ancestor becomes the
  // containing block for `position: fixed`, which would trap this overlay
  // inside the card instead of covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0A0A0A] border border-[#2E2E2E] rounded-2xl p-6 w-full max-w-sm font-mono" onClick={e => e.stopPropagation()}>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Update Photo</p>
        <h3 className="text-white font-bold text-sm mb-4">{name} <span className="text-gray-600 font-normal text-xs">({accusedId})</span></h3>

        <div className="flex justify-center mb-4">
          <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-[#2E2E2E] bg-[#111] flex items-center justify-center flex-shrink-0">
            {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : <DefaultSilhouette className="w-1/2 h-1/2" />}
          </div>
        </div>

        <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="w-full bg-[#000000] border border-[#2E2E2E] hover:border-white/40 text-gray-300 hover:text-white text-xs py-2 rounded-lg transition mb-2 disabled:opacity-40">
          Choose photo…
        </button>

        {error && <p className="text-red-400 text-[11px] mt-1">{error}</p>}

        <div className="flex gap-2 mt-4">
          {currentPhoto && (
            <button onClick={remove} disabled={busy}
              className="flex-1 text-xs py-2 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/30 transition disabled:opacity-40">
              Remove
            </button>
          )}
          <button onClick={onClose} disabled={busy}
            className="flex-1 text-xs py-2 rounded-lg border border-[#2E2E2E] text-gray-400 hover:text-white transition">
            Cancel
          </button>
          <button onClick={save} disabled={busy || !preview}
            className="flex-1 text-xs py-2 rounded-lg bg-white text-black font-bold hover:opacity-90 transition disabled:opacity-40">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="text-[9px] text-gray-600 mt-3 text-center leading-relaxed">
          Resized to {MAX_DIM}px and stored in the KAVACH Data Store — no real mugshot exists in this dataset, this is officer-attached.
        </p>
      </div>
    </div>
  , document.body)
}
