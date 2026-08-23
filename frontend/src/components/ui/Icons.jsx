// Consistent stroke-based icon set (replaces emoji throughout the app).
// Each icon accepts className/size like a normal inline SVG component.

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }

export function IconChat({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M21 12c0 4.418-4.03 8-9 8-1.06 0-2.077-.16-3.02-.457L3 21l1.55-4.65C3.573 15.11 3 13.61 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}
export function IconAnalytics({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  )
}
export function IconNetwork({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="12" cy="18" r="2.4" />
      <path d="M8 7.2 10.5 16M16 7.2 13.5 16M8.4 6h7.2" />
    </svg>
  )
}
export function IconProfiler({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="8" r="3.4" /><path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" />
    </svg>
  )
}
export function IconForecast({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3v2.2M18.4 5.6l-1.5 1.5M21 12h-2.2M5.6 5.6l1.5 1.5M3 12h2.2" />
      <path d="M8 17a4 4 0 1 1 7.6-1.8A3 3 0 0 1 15 21H9a3 3 0 0 1-1-5.8z" />
    </svg>
  )
}
export function IconSociological({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" /><path d="M12 3a9 15 0 0 1 0 18M12 3a9 15 0 0 0 0 18M3 12h18" />
    </svg>
  )
}
export function IconFinancial({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" /><path d="M9.5 15.5c0 1 1 1.8 2.5 1.8s2.5-.7 2.5-1.6c0-2.4-5-1.2-5-3.6 0-.9 1-1.6 2.5-1.6s2.5.7 2.5 1.7M12 7v1.2M12 15.8V17" />
    </svg>
  )
}
export function IconReports({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M9 12h6M9 16h6M9 8h2" />
    </svg>
  )
}
export function IconMic({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  )
}
export function IconEdit({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}
export function IconCopy({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="9" y="9" width="11" height="11" rx="1.8" />
      <path d="M5 15V5a1.8 1.8 0 0 1 1.8-1.8H15" />
    </svg>
  )
}
export function IconLogout({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}
export function IconCollapse({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}
export function IconExpand({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
export function IconCheck({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12.5 9.5 18 20 6" />
    </svg>
  )
}
export function IconSpeaker({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M17.5 7a7 7 0 0 1 0 10" />
    </svg>
  )
}
export function IconSpeakerOff({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" />
      <path d="m15 9 5 6M20 9l-5 6" />
    </svg>
  )
}
export function IconTimeline({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 4v16" />
      <circle cx="12" cy="6" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="18" r="1.8" />
      <path d="M14.5 6H20M14.5 12H19M14.5 18H20" />
    </svg>
  )
}
export function IconBriefing({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M9 12h6M9 16h6" />
      <path d="M16.5 6.5 15 3.5l1.8-.5.5-1.8.5 1.8 1.8.5-1.8.5-.5 1.8-.5-1.8z" />
    </svg>
  )
}
export function IconPlus({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
export function IconTrash({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  )
}
export function IconMessage({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M21 12c0 4.418-4.03 8-9 8-1.06 0-2.077-.16-3.02-.457L3 21l1.55-4.65C3.573 15.11 3 13.61 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}
export function IconAlert({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3.5 21.5 20h-19L12 3.5z" />
      <path d="M12 10v4.2M12 17.2v.1" />
    </svg>
  )
}
export function IconInfo({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </svg>
  )
}
export function IconDownload({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14" />
    </svg>
  )
}
export function IconEye({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
export function IconEyeOff({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 4l16 16M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.5 17.5 0 0 1-3.2 3.9M6 8a17 17 0 0 0-3.5 4S6 18.5 12 18.5c1 0 2-.2 2.8-.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}
export function IconLock({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </svg>
  )
}
export function IconFlame({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3c1 3-3.5 5.5-3.5 9a3.5 3.5 0 0 0 7 0c0-1.3-.6-2.3-1.2-3.2C16.4 9.6 18 11.6 18 14a6 6 0 0 1-12 0c0-5 5-7 6-11z" />
    </svg>
  )
}
export function IconBolt({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M13 2 5 13.5h5L11 22l8-11.5h-5L13 2z" />
    </svg>
  )
}
export function IconArrowUpRight({ className = 'w-3 h-3' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  )
}
export function IconSparkle({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3.5 13.8 9 19.5 11l-5.7 2L12 18.5 10.2 13 4.5 11l5.7-2L12 3.5z" />
      <path d="M18.5 3.5 19 5l1.5.5L19 6l-.5 1.5L18 6l-1.5-.5L18 5l.5-1.5z" />
    </svg>
  )
}
export function IconNode({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="8.5" opacity="0.4" />
    </svg>
  )
}
export function IconScan({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </svg>
  )
}
export function IconDots({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}
