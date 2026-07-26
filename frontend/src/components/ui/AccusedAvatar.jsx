import { useState } from 'react'
import PhotoUploadModal from './PhotoUploadModal'

// Default "wanted poster" placeholder — no real mugshots exist in this
// dataset, so every accused shows this silhouette until an officer attaches
// a photo. `editable` reveals a click-to-update affordance on hover.
export default function AccusedAvatar({ accusedId, name, photoUrl, size = 40, borderColor = '#2E2E2E', editable = false, onPhotoChange }) {
  const [modalOpen, setModalOpen] = useState(false)
  const dim = { width: size, height: size }
  const borderWidth = size >= 72 ? 3 : size >= 48 ? 2.5 : 2
  const badgeSize = Math.max(16, Math.round(size * 0.32))

  return (
    <>
      <div className="relative flex-shrink-0" style={dim}>
        <div
          className={`rounded-full overflow-hidden flex items-center justify-center bg-[#111] w-full h-full ${editable ? 'group cursor-pointer' : ''}`}
          style={{ border: `${borderWidth}px solid ${borderColor}`, boxShadow: `0 0 0 1px rgba(255,255,255,0.06)` }}
          onClick={editable ? (e) => { e.stopPropagation(); setModalOpen(true) } : undefined}
          title={editable ? 'Click to update photo' : name}
        >
          {photoUrl ? (
            <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#555" strokeWidth="1.5">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" />
            </svg>
          )}
          {editable && (
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="40%" height="40%" fill="none" stroke="#fff" strokeWidth="1.8">
                <path d="M4 8a2 2 0 0 1 2-2h1l1-2h8l1 2h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
            </div>
          )}
        </div>
        {/* Persistent camera badge (not just on hover) so it reads as
            click-to-update at a glance, even without mousing over it. */}
        {editable && (
          <div
            className="absolute rounded-full bg-white flex items-center justify-center border-2 border-[#000] pointer-events-none"
            style={{ width: badgeSize, height: badgeSize, right: -2, bottom: -2 }}
          >
            <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#000" strokeWidth="2.2">
              <path d="M4 8a2 2 0 0 1 2-2h1l1-2h8l1 2h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </div>
        )}
      </div>
      {editable && modalOpen && (
        <PhotoUploadModal
          accusedId={accusedId} name={name} currentPhoto={photoUrl}
          onClose={() => setModalOpen(false)}
          onSaved={(url) => { onPhotoChange?.(url); setModalOpen(false) }}
        />
      )}
    </>
  )
}
