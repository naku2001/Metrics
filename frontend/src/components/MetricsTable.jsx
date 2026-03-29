const METRIC_ROWS = [
  { key: 'mrr',        label: 'MRR',        group: 'Overall' },
  { key: 'ndcg@1',     label: 'NDCG@1',     group: 'NDCG' },
  { key: 'ndcg@3',     label: 'NDCG@3',     group: 'NDCG' },
  { key: 'ndcg@5',     label: 'NDCG@5',     group: 'NDCG' },
  { key: 'ndcg@10',    label: 'NDCG@10',    group: 'NDCG' },
  { key: 'recall@1',   label: 'Recall@1',   group: 'Recall' },
  { key: 'recall@3',   label: 'Recall@3',   group: 'Recall' },
  { key: 'recall@5',   label: 'Recall@5',   group: 'Recall' },
  { key: 'recall@10',  label: 'Recall@10',  group: 'Recall' },
]

function getBest(results, key) {
  let best = -Infinity
  for (const m of Object.values(results)) {
    if (m.metrics?.[key] > best) best = m.metrics[key]
  }
  return best
}

export default function MetricsTable({ results }) {
  const models = Object.keys(results)
  if (!models.length) return null

  const groups = [...new Set(METRIC_ROWS.map(r => r.group))]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 font-mono text-xs text-text-muted uppercase tracking-wider w-32">
              Metric
            </th>
            {models.map(model => (
              <th key={model} className="text-right py-3 px-4 font-mono text-xs text-accent tracking-wide">
                {model.split('/').pop()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <>
              <tr key={`group-${group}`} className="bg-faint/30">
                <td colSpan={models.length + 1} className="px-4 py-1.5 text-[10px] font-mono text-text-muted uppercase tracking-widest">
                  {group}
                </td>
              </tr>
              {METRIC_ROWS.filter(r => r.group === group).map((row, ri) => {
                const best = getBest(results, row.key)
                return (
                  <tr
                    key={row.key}
                    className="border-b border-border/50 hover:bg-faint/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono text-xs text-text-secondary">{row.label}</td>
                    {models.map(model => {
                      const val = results[model]?.metrics?.[row.key]
                      const isBest = val !== undefined && Math.abs(val - best) < 0.0001
                      return (
                        <td key={model} className="py-2.5 px-4 text-right">
                          {val !== undefined ? (
                            <span className={`
                              font-mono tabular-nums text-sm
                              ${isBest ? 'text-accent text-glow-accent font-semibold' : 'text-text-secondary'}
                            `}>
                              {val.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-text-muted font-mono">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
