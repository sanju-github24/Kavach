export function SkeletonBlock({ className = '', style }) {
  return <div className={`skeleton ${className}`} style={style} />
}

export function SkeletonStatRow({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kv-panel p-4">
          <SkeletonBlock className="h-8 w-20 mb-3" />
          <SkeletonBlock className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonPanel({ height = 260 }) {
  return (
    <div className="kv-panel p-5">
      <SkeletonBlock className="h-3 w-32 mb-4" />
      <SkeletonBlock style={{ height }} className="w-full" />
    </div>
  )
}
