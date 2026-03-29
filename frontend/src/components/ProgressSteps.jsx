const STEPS = ['Extracting', 'Chunking', 'Generating QA', 'Embedding', 'Scoring']

const STATUS = { pending: 0, active: 1, done: 2, error: 3 }

export default function ProgressSteps({ currentStep, error }) {
  // currentStep: null | 'extracting' | 'chunking' | 'generating_qa' | 'embedding' | 'scoring' | 'done'
  const stepKeys = ['extracting', 'chunking', 'generating_qa', 'embedding', 'scoring']

  function getStatus(key, label) {
    if (error) {
      const cur = stepKeys.indexOf(currentStep)
      const idx = stepKeys.indexOf(key)
      if (idx < cur) return STATUS.done
      if (idx === cur) return STATUS.error
      return STATUS.pending
    }
    if (currentStep === 'done') return STATUS.done
    if (!currentStep) return STATUS.pending
    const cur = stepKeys.indexOf(currentStep)
    const idx = stepKeys.indexOf(key)
    if (idx < cur) return STATUS.done
    if (idx === cur) return STATUS.active
    return STATUS.pending
  }

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const key = stepKeys[i]
        const status = getStatus(key, label)
        const isLast = i === STEPS.length - 1

        return (
          <div key={key} className="flex items-center">
            {/* Node */}
            <div className="flex flex-col items-center gap-1.5">
              <div className={`
                w-7 h-7 rounded-sm flex items-center justify-center text-xs font-mono font-bold
                transition-all duration-300
                ${status === STATUS.done    ? 'bg-success/20 border border-success text-success' : ''}
                ${status === STATUS.active  ? 'bg-accent/20 border border-accent text-accent shadow-glow-accent animate-pulse-slow' : ''}
                ${status === STATUS.pending ? 'bg-faint border border-border text-text-muted' : ''}
                ${status === STATUS.error   ? 'bg-danger/20 border border-danger text-danger' : ''}
              `}>
                {status === STATUS.done   && <CheckIcon />}
                {status === STATUS.active && <span>{i + 1}</span>}
                {status === STATUS.pending && <span className="text-[10px]">{i + 1}</span>}
                {status === STATUS.error  && <XIcon />}
              </div>
              <span className={`
                text-[10px] font-mono tracking-wide whitespace-nowrap uppercase
                ${status === STATUS.done    ? 'text-success' : ''}
                ${status === STATUS.active  ? 'text-accent text-glow-accent' : ''}
                ${status === STATUS.pending ? 'text-text-muted' : ''}
                ${status === STATUS.error   ? 'text-danger' : ''}
              `}>
                {label}
              </span>
            </div>

            {/* Connector */}
            {!isLast && (
              <div className={`
                h-px w-12 mx-1 mb-5 transition-all duration-500
                ${status === STATUS.done ? 'bg-success/40' : 'bg-border'}
              `} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
