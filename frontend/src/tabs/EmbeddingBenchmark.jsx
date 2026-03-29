import { useEffect, useRef, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell,
} from 'recharts'
import ProgressSteps from '../components/ProgressSteps'
import MetricsTable from '../components/MetricsTable'
import ChunkBreakdown from '../components/ChunkBreakdown'
import TsnePlot from '../components/TsnePlot'

const PRESET_MODELS = [
  'sentence-transformers/all-MiniLM-L6-v2',
  'BAAI/bge-small-en-v1.5',
  'BAAI/bge-large-en-v1.5',
  'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  'intfloat/e5-small-v2',
  'intfloat/multilingual-e5-large',
]

const BAR_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa']

function parseSSELine(line) {
  if (line.startsWith('data: ')) {
    try { return JSON.parse(line.slice(6)) } catch { return null }
  }
  return null
}

async function* readSSE(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      const event = parseSSELine(line.trim())
      if (event) yield event
    }
  }
}

export default function EmbeddingBenchmark({ activeMode }) {
  const fileRef = useRef(null)

  // Upload / QA state
  const [uploadState, setUploadState] = useState({ status: 'idle' }) // idle | uploading | qa | done | error
  const [pdfHash, setPdfHash]         = useState(null)
  const [chunks, setChunks]           = useState([])
  const [qaPairs, setQaPairs]         = useState([])
  const [fromCache, setFromCache]     = useState(false)
  const [qaProgress, setQaProgress]   = useState({ done: 0, total: 0 })

  // Embedding source
  const [embSource, setEmbSource]           = useState('huggingface') // 'huggingface' | 'ollama'
  const [ollamaModels, setOllamaModels]     = useState([])
  const [ollamaError, setOllamaError]       = useState('')
  const [modelStatus, setModelStatus]       = useState({}) // { [modelName]: bool } — true = cached locally
  const ollamaUrl = localStorage.getItem('ollama_base_url') || 'http://localhost:11434'

  // Benchmark state
  const [selectedModels, setSelectedModels] = useState([PRESET_MODELS[0]])
  const [benchState, setBenchState]         = useState({ status: 'idle' }) // idle | running | done | error
  const [currentStep, setCurrentStep]       = useState(null)
  const [currentModel, setCurrentModel]     = useState('')
  const [modelProgress, setModelProgress]   = useState({ idx: 0, total: 0 })
  const [embedProgress, setEmbedProgress]   = useState({ phase: '', done: 0, total: 0 })
  const [results, setResults]               = useState({})
  const [tsne, setTsne]                     = useState(null)

  // Fetch local cache status for HuggingFace models
  useEffect(() => {
    if (embSource !== 'huggingface') return
    fetch('/api/models/status')
      .then(r => r.json())
      .then(data => {
        const map = {}
        data.forEach(({ model, cached }) => { map[model] = cached })
        setModelStatus(map)
      })
      .catch(() => {})
  }, [embSource])

  // Fetch Ollama models when source switches to ollama
  useEffect(() => {
    if (embSource !== 'ollama') return
    setOllamaError('')
    fetch(`${ollamaUrl}/api/tags`)
      .then(r => r.json())
      .then(d => {
        setOllamaModels(d.models ?? [])
        if (d.models?.length) setSelectedModels([d.models[0].name])
      })
      .catch(() => setOllamaError('Ollama is not running or CORS not enabled.'))
  }, [embSource])

  // -----------------------------------------------------------------------
  // Step 1: Upload PDF → extract + chunk
  // -----------------------------------------------------------------------
  async function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return
    setUploadState({ status: 'uploading' })
    setCurrentStep('extracting')
    setPdfHash(null)
    setChunks([])
    setQaPairs([])
    setResults({})
    setTsne(null)

    try {
      const form = new FormData()
      form.append('file', file)
      setCurrentStep('chunking')
      const r = await fetch('/api/upload', { method: 'POST', body: form })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.detail || 'Upload failed')
      }
      const d = await r.json()
      setPdfHash(d.pdf_hash)
      setChunks(d.chunks)
      setUploadState({ status: 'qa' })
      setCurrentStep('generating_qa')
      await generateQA(d.pdf_hash, d.chunks)
    } catch (e) {
      setUploadState({ status: 'error', message: e.message })
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Generate QA pairs (streaming)
  // -----------------------------------------------------------------------
  async function generateQA(hash, chunkList) {
    const headers = { 'Content-Type': 'application/json' }
    if (activeMode) headers['X-Hardware-Mode'] = activeMode

    const r = await fetch('/api/generate-qa', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pdf_hash: hash, chunks: chunkList }),
    })
    if (!r.ok) throw new Error('QA generation request failed')

    for await (const event of readSSE(r)) {
      if (event.type === 'cached') {
        setQaPairs(event.qa_pairs)
        setFromCache(true)
        setUploadState({ status: 'done' })
        setCurrentStep(null)
        return
      }
      if (event.type === 'progress') {
        setQaProgress({ done: event.done, total: event.total })
      }
      if (event.type === 'done') {
        setQaPairs(event.qa_pairs)
        setFromCache(false)
        setUploadState({ status: 'done' })
        setCurrentStep(null)
        return
      }
      if (event.type === 'error') {
        throw new Error(event.message)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Run embedding benchmark (streaming)
  // -----------------------------------------------------------------------
  async function runBenchmark() {
    setBenchState({ status: 'running' })
    setResults({})
    setTsne(null)
    setCurrentModel('')
    setModelProgress({ idx: 0, total: selectedModels.length })
    setEmbedProgress({ phase: '', done: 0, total: 0 })

    const headers = { 'Content-Type': 'application/json' }
    if (activeMode) headers['X-Hardware-Mode'] = activeMode

    try {
      const r = await fetch('/api/benchmark', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pdf_hash: pdfHash,
          models: selectedModels,
          chunks,
          qa_pairs: qaPairs,
          embedding_source: embSource,
          ollama_base_url: ollamaUrl,
        }),
      })
      if (!r.ok) throw new Error('Benchmark request failed')

      for await (const event of readSSE(r)) {
        if (event.type === 'step') {
          setCurrentStep(event.step)
          if (event.step === 'embedding') {
            setCurrentModel(event.model)
            setModelProgress({ idx: event.idx, total: event.total })
            setEmbedProgress({ phase: 'chunks', done: 0, total: chunks.length })
          }
          if (event.step === 'downloading') {
            setCurrentModel(event.model)
          }
          if (event.step === 'scoring') {
            setEmbedProgress({ phase: '', done: 0, total: 0 })
          }
        }
        if (event.type === 'embed_progress') {
          setEmbedProgress({ phase: event.phase, done: event.done, total: event.total })
        }
        if (event.type === 'model_done') {
          setResults(prev => ({ ...prev, [event.model]: { metrics: event.metrics } }))
          setModelStatus(prev => ({ ...prev, [event.model]: true }))
        }
        if (event.type === 'done') {
          setResults(event.results)
          setTsne(event.tsne)
          setBenchState({ status: 'done' })
          setCurrentStep('done')
          setCurrentModel('')
          setEmbedProgress({ phase: '', done: 0, total: 0 })
        }
        if (event.type === 'error') {
          throw new Error(event.message)
        }
      }
    } catch (e) {
      setBenchState({ status: 'error', message: e.message })
    }
  }

  const isRunning   = uploadState.status === 'uploading' || uploadState.status === 'qa' || benchState.status === 'running'
  const uploadDone  = uploadState.status === 'done'
  const hasResults  = benchState.status === 'done' && Object.keys(results).length > 0

  // NDCG@10 bar chart data
  const ndcgData = Object.entries(results).map(([model, r], i) => ({
    model: model.split('/').pop(),
    value: r.metrics?.['ndcg@10'] ?? 0,
    fill: BAR_COLORS[i % BAR_COLORS.length],
  }))

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Upload zone */}
      <section className="card p-6">
        <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary mb-4">
          01 / Upload PDF
        </h2>

        <div
          className={`border-2 border-dashed rounded-sm flex flex-col items-center justify-center gap-3 py-12 cursor-pointer transition-all duration-200 ${
            isRunning ? 'opacity-50 cursor-not-allowed border-border' :
            'border-border hover:border-accent/50 hover:bg-accent/[0.03]'
          }`}
          onClick={() => !isRunning && fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            if (!isRunning) handleFile(e.dataTransfer.files[0])
          }}
        >
          <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="font-mono text-sm text-text-muted">
            Drop PDF here or <span className="text-accent">click to browse</span>
          </p>
        </div>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={e => handleFile(e.target.files[0])} />

        {/* Cache notice */}
        {uploadDone && (
          <div className={`mt-4 flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-sm border ${
            fromCache
              ? 'border-warning/30 bg-warning/5 text-warning'
              : 'border-success/30 bg-success/5 text-success'
          }`}>
            <span>{fromCache ? '⚡ Loaded from cache' : '✓ QA pairs generated fresh'}</span>
            <span className="text-text-muted ml-auto">{chunks.length} chunks · {qaPairs.reduce((n, q) => n + q.questions.length, 0)} questions</span>
          </div>
        )}

        {/* Error */}
        {uploadState.status === 'error' && (
          <ErrorBanner message={uploadState.message} />
        )}
      </section>

      {/* Progress */}
      {(isRunning || uploadDone || hasResults) && (
        <section className="card p-6 flex flex-col gap-5">
          <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
            02 / Pipeline Progress
          </h2>
          <ProgressSteps currentStep={currentStep} error={benchState.status === 'error'} />

          {/* Step detail */}
          {(uploadState.status === 'qa' || benchState.status === 'running') && (
            <div className="border border-border rounded-sm bg-base/60 px-4 py-3 space-y-3">

              {/* Generating QA */}
              {uploadState.status === 'qa' && qaProgress.total > 0 && (
                <StepDetail
                  label="Generating QA pairs via OpenRouter"
                  done={qaProgress.done}
                  total={qaProgress.total}
                  color="accent"
                />
              )}
              {uploadState.status === 'qa' && qaProgress.total === 0 && (
                <p className="text-xs font-mono text-accent animate-pulse-slow">Connecting to OpenRouter…</p>
              )}

              {/* Downloading model */}
              {currentStep === 'downloading' && currentModel && (
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin flex-shrink-0" />
                  <span className="text-xs font-mono text-accent">
                    Downloading <span className="text-text-primary">{currentModel.split('/').pop()}</span> from HuggingFace Hub…
                  </span>
                </div>
              )}

              {/* Embedding chunks */}
              {currentStep === 'embedding' && currentModel && (
                <>
                  <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                    <span className="text-accent">{currentModel}</span>
                    <span>model {modelProgress.idx} of {modelProgress.total}</span>
                  </div>
                  {embedProgress.phase === 'chunks' && embedProgress.total > 0 && (
                    <StepDetail
                      label="Embedding chunks"
                      done={embedProgress.done}
                      total={embedProgress.total}
                      color="accent"
                    />
                  )}
                  {embedProgress.phase === 'questions' && embedProgress.total > 0 && (
                    <StepDetail
                      label="Embedding questions"
                      done={embedProgress.done}
                      total={embedProgress.total}
                      color="violet"
                    />
                  )}
                </>
              )}

              {/* Scoring */}
              {currentStep === 'scoring' && (
                <p className="text-xs font-mono text-text-secondary animate-pulse-slow">
                  Computing ranx metrics for <span className="text-accent">{currentModel}</span>…
                </p>
              )}

              {/* t-SNE */}
              {currentStep === 'tsne' && (
                <p className="text-xs font-mono text-text-secondary animate-pulse-slow">
                  Computing t-SNE + KMeans clustering…
                </p>
              )}
            </div>
          )}

          {benchState.status === 'error' && (
            <ErrorBanner message={benchState.message} />
          )}
        </section>
      )}

      {/* Model selection + run */}
      {uploadDone && (
        <section className="card p-6 space-y-5">
          <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
            03 / Select Models
          </h2>

          {/* Source toggle */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest">Embedding Source</p>
            <div className="flex gap-1 w-fit">
              {[
                { id: 'huggingface', label: 'HuggingFace (local)' },
                { id: 'ollama',      label: 'Ollama (local)' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setEmbSource(opt.id)
                    setSelectedModels(opt.id === 'huggingface' ? [PRESET_MODELS[0]] : [])
                  }}
                  disabled={isRunning}
                  className={`px-4 py-2 text-xs font-mono font-semibold uppercase tracking-wider rounded-sm border transition-all duration-150 ${
                    embSource === opt.id
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-border bg-faint text-text-muted hover:border-border-bright hover:text-text-secondary'
                  } disabled:opacity-50`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* HuggingFace preset list */}
          {embSource === 'huggingface' && (
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-text-muted">
                Runs locally via sentence-transformers · models downloaded from HuggingFace Hub and cached on disk
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESET_MODELS.map(m => {
                  const selected = selectedModels.includes(m)
                  const cached   = modelStatus[m]
                  return (
                    <button
                      key={m}
                      onClick={() => setSelectedModels(prev =>
                        selected ? prev.filter(x => x !== m) : [...prev, m]
                      )}
                      disabled={isRunning}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-mono border transition-all duration-150 ${
                        selected
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-border bg-faint text-text-muted hover:border-border-bright hover:text-text-secondary'
                      } disabled:opacity-50`}
                    >
                      {/* cache dot */}
                      <span
                        title={cached === true ? 'Cached locally' : cached === false ? 'Will download on first run' : ''}
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          cached === true  ? 'bg-success' :
                          cached === false ? 'bg-warning' :
                          'bg-border'
                        }`}
                      />
                      {m.split('/').pop()}
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] font-mono text-text-muted">
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block"/>cached</span>
                {' · '}
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-warning inline-block"/>will download</span>
              </p>
            </div>
          )}

          {/* Ollama model list */}
          {embSource === 'ollama' && (
            <div className="space-y-2">
              {ollamaError ? (
                <p className="text-xs font-mono text-danger">{ollamaError}</p>
              ) : ollamaModels.length === 0 ? (
                <p className="text-xs font-mono text-text-muted animate-pulse-slow">Loading Ollama models…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ollamaModels.map(m => {
                    const selected = selectedModels.includes(m.name)
                    return (
                      <button
                        key={m.name}
                        onClick={() => setSelectedModels(prev =>
                          selected ? prev.filter(x => x !== m.name) : [...prev, m.name]
                        )}
                        disabled={isRunning}
                        className={`px-3 py-1.5 rounded-sm text-xs font-mono border transition-all duration-150 ${
                          selected
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'border-border bg-faint text-text-muted hover:border-border-bright hover:text-text-secondary'
                        } disabled:opacity-50`}
                      >
                        {m.name}
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] font-mono text-text-muted">
                Tip: install embedding models with{' '}
                <code className="text-text-secondary">ollama pull nomic-embed-text</code>
                {' '}or{' '}
                <code className="text-text-secondary">ollama pull mxbai-embed-large</code>
              </p>
            </div>
          )}

          <button
            onClick={runBenchmark}
            disabled={isRunning || selectedModels.length === 0}
            className="btn-primary"
          >
            {benchState.status === 'running' ? 'Running…' : 'Run Benchmark'}
          </button>
        </section>
      )}

      {/* Results */}
      {hasResults && (
        <>
          {/* Metrics table */}
          <section className="card p-6 space-y-4">
            <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
              04 / Metrics Comparison
            </h2>
            <MetricsTable results={results} />
          </section>

          {/* NDCG@10 bar chart */}
          <section className="card p-6 space-y-4">
            <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
              NDCG@10 Comparison
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={ndcgData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#1e2d42" />
                <XAxis
                  dataKey="model"
                  tick={{ fill: '#4b6080', fontSize: 11, fontFamily: 'Fira Code' }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  domain={[0, 1]} tickCount={6}
                  tick={{ fill: '#4b6080', fontSize: 10, fontFamily: 'Fira Code' }}
                  axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: '#0c1220', border: '1px solid #1e2d42', borderRadius: 2, fontFamily: 'Fira Code', fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                  itemStyle={{ color: '#22d3ee' }}
                />
                <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                  {ndcgData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>

          {/* t-SNE */}
          {tsne && (
            <section className="card p-6 space-y-4">
              <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
                Chunk Embedding Space (t-SNE)
              </h2>
              <p className="text-xs font-mono text-text-muted">
                First model · {tsne.coords.length} chunks · colored by cluster
              </p>
              <TsnePlot tsne={tsne} />
            </section>
          )}

          {/* Per-chunk breakdown */}
          <section className="card p-6 space-y-4">
            <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
              Per-Chunk Breakdown
            </h2>
            <p className="text-xs font-mono text-text-muted">Click any row to expand questions and retrieval results.</p>
            <ChunkBreakdown results={results} />
          </section>
        </>
      )}
    </div>
  )
}

function StepDetail({ label, done, total, color = 'accent' }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const barColor = color === 'violet' ? 'bg-violet' : 'bg-accent'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-mono text-text-muted">
        <span>{label}</span>
        <span className={color === 'violet' ? 'text-violet' : 'text-accent'}>
          {done}/{total} <span className="text-text-muted">({pct}%)</span>
        </span>
      </div>
      <div className="h-1 bg-faint rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-2 mt-3 px-3 py-2 border border-danger/30 bg-danger/5 rounded-sm text-xs font-mono text-danger">
      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      {message}
    </div>
  )
}
