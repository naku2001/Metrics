import { useState } from 'react'

export default function ChunkBreakdown({ results }) {
  const models = Object.keys(results)
  if (!models.length) return null

  // Merge per-chunk data across models
  const firstModel = models[0]
  const chunks = results[firstModel]?.per_chunk
  if (!chunks?.length) return null

  return (
    <div className="space-y-1">
      {chunks.map((chunk, ci) => (
        <ChunkRow key={chunk.chunk_id} chunk={chunk} models={models} results={results} index={ci} />
      ))}
    </div>
  )
}

function ChunkRow({ chunk, models, results, index }) {
  const [open, setOpen] = useState(false)

  // Compute per-model correctness summary for this chunk
  const summary = models.map(model => {
    const modelChunk = results[model]?.per_chunk?.[index]
    const correct = modelChunk?.questions.filter(q => q.correct).length ?? 0
    const total = modelChunk?.questions.length ?? 0
    return { model, correct, total }
  })

  const allPerfect = summary.every(s => s.correct === s.total)
  const allZero    = summary.every(s => s.correct === 0)

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-faint/40 transition-colors text-left"
      >
        {/* Expand icon */}
        <svg
          className={`w-3.5 h-3.5 text-text-muted flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        {/* Chunk id */}
        <span className="font-mono text-xs text-text-muted w-20 flex-shrink-0">
          {chunk.chunk_id}
        </span>

        {/* Chunk preview */}
        <span className="flex-1 text-sm text-text-secondary truncate">
          {chunk.chunk_text.slice(0, 120)}…
        </span>

        {/* Per-model score pills */}
        <div className="flex gap-2 flex-shrink-0">
          {summary.map(s => (
            <span
              key={s.model}
              className={`badge text-[10px] ${
                s.correct === s.total ? 'bg-success/10 border border-success/30 text-success' :
                s.correct === 0       ? 'bg-danger/10 border border-danger/30 text-danger' :
                                        'bg-warning/10 border border-warning/30 text-warning'
              }`}
              title={s.model}
            >
              {s.correct}/{s.total}
            </span>
          ))}
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border bg-base/50 px-4 py-4 space-y-4 animate-fade-in">
          {/* Full chunk text */}
          <div>
            <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2">Chunk Text</p>
            <p className="text-sm text-text-secondary leading-relaxed font-body">{chunk.chunk_text}</p>
          </div>

          {/* Questions table */}
          <div>
            <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2">Questions & Retrieval</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-mono text-text-muted">Question</th>
                    {models.map(m => (
                      <th key={m} className="text-center py-2 px-3 font-mono text-accent/70 whitespace-nowrap">
                        {m.split('/').pop()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chunk.questions.map((q, qi) => (
                    <tr key={qi} className="border-b border-border/30">
                      <td className="py-2 px-3 text-text-secondary max-w-xs">{q.question}</td>
                      {models.map(model => {
                        const mq = results[model]?.per_chunk?.[chunk.chunk_id !== undefined ? results[model].per_chunk.findIndex(c => c.chunk_id === chunk.chunk_id) : 0]?.questions?.[qi]
                        if (!mq) return <td key={model} className="py-2 px-3 text-center text-text-muted">—</td>
                        return (
                          <td key={model} className="py-2 px-3 text-center">
                            <span className={`font-mono ${mq.correct ? 'text-success' : 'text-danger'}`}>
                              rank {mq.rank ?? '?'}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
