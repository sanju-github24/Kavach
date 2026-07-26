// Default "wanted poster" silhouette as a raw SVG data URI — for contexts
// where a React component isn't usable (Cytoscape node background-image),
// matching the same placeholder AccusedAvatar renders elsewhere.
export const DEFAULT_AVATAR_DATA_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">
  <rect width="24" height="24" fill="#111111"/>
  <circle cx="12" cy="8" r="3.5" fill="none" stroke="#555555" stroke-width="1.5"/>
  <path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" fill="none" stroke="#555555" stroke-width="1.5"/>
</svg>
`.trim())
