// The KAVACH mark — a shield (kavach = armor/shield) with a watching eye at
// its center, standing in for both "protection" and "intelligence". Used as
// the sidebar/login brand mark and mirrored exactly in the favicon (public/
// favicon.svg) and the PDF report letterhead (utils/pdfKit.js) so the same
// logo appears everywhere instead of the placeholder 🛡️ emoji / "KSP" badge.
export default function KavachLogo({ size = 36, rounded = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="flex-shrink-0">
      {rounded && <rect width="64" height="64" rx="14" fill="#0A0A0A" />}
      <path d="M32 10 L48 15 V30 C48 42 41 50 32 54 C23 50 16 42 16 30 V15 Z" fill="#FFFFFF" />
      <circle cx="32" cy="31" r="10" fill="#0A0A0A" />
      <circle cx="32" cy="31" r="3.6" fill="#FFFFFF" />
    </svg>
  )
}
