// Renders a guaranteed-correct table inline in a chat message — the backend
// builds this directly from the same structured data it queried (not by
// parsing markdown the model wrote), so it's always accurate regardless of
// how the model's prose happens to be phrased. A wall of text is slow to
// scan; a table with the same facts reads in seconds.
export default function InlineTable({ data }) {
  if (!data?.columns?.length || !data?.rows?.length) return null
  const { columns, rows } = data

  return (
    <div className="mt-3 border border-base-border rounded-xl overflow-hidden">
      <p className="text-[9px] text-ink-faint uppercase tracking-widest px-3 pt-2.5 pb-1">At a glance</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className="text-left text-ink-faint font-semibold uppercase tracking-wide text-[9.5px] px-3 py-2 border-b border-base-border whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-white/[0.03] transition-colors">
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-3 py-2 border-b border-base-border/60 last:border-b-0 whitespace-nowrap ${
                      ci === 0 ? 'text-white font-semibold' : 'text-ink-dim tabular-nums'
                    } ${ri === rows.length - 1 ? '!border-b-0' : ''}`}
                  >
                    {cell === null || cell === undefined || cell === '' ? '—' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
