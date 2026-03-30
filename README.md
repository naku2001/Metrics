# AI Benchmarking Dashboard

A local web application for benchmarking embedding models and Ollama LLMs. Upload a PDF, generate synthetic QA pairs, run retrieval benchmarks across multiple embedding models, and measure LLM inference performance — all running on your own hardware.

![Dark theme dashboard](https://img.shields.io/badge/theme-dark-0c1220?style=flat-square)
![Python](https://img.shields.io/badge/python-3.8%2B-3776ab?style=flat-square&logo=python&logoColor=white)
![React](https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/fastapi-0.100%2B-009688?style=flat-square&logo=fastapi&logoColor=white)

---

## Features

### Embedding Benchmark
- Upload any PDF — text is extracted, chunked (~300 words, 50-word overlap), and 3 synthetic QA pairs are generated per chunk via OpenRouter
- Benchmark up to 6 preset HuggingFace embedding models side-by-side
- Models are downloaded from HuggingFace Hub and cached locally — a green/amber indicator shows cache status per model
- Retrieval scoring via **ranx**: MRR, Recall@1/3/5/10, NDCG@1/3/5/10
- Live step-by-step progress (Extract → Chunk → Generate QA → Download → Embed → Score)
- NDCG@10 bar chart comparison across models
- t-SNE scatter plot of chunk embeddings, colored by KMeans cluster
- Per-chunk breakdown: chunk text, generated questions, which model retrieved it and at what rank
- QA pairs cached to disk by PDF hash — skips regeneration on repeat runs

### Ollama LLM Metrics
- Automatically lists every model installed in your local Ollama instance
- Fully editable test prompts — add, delete, edit label and text, persisted in `localStorage`
- 5 default prompts: Factual, Reasoning, Creative, Code, Summarize
- Measures per-prompt and average: **TPS**, **TTFT** (client-side), **Prefill TPS**, token count, model load time
- Live token stream preview during generation
- RAM and CPU gauges updated every 2 seconds during benchmark
- VRAM gauge visible only when a GPU is detected
- TPS chart Y-axis scales to hardware: CPU (15), NVIDIA (120), AMD (100)
- Per-prompt results table and model summary cards

### Hardware Detection
- Auto-detects NVIDIA GPU via `pynvml`, AMD GPU via `rocm-smi`, falls back to CPU mode
- Hardware badge in settings shows detected GPU name and VRAM
- Manual override toggle (CPU / NVIDIA / AMD) persisted in `localStorage`
- All metric collection paths adapt to the active hardware mode

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS (dark theme) |
| Backend | FastAPI, Python 3.8+ |
| Embeddings | `sentence-transformers` (local inference) |
| Retrieval metrics | `ranx` — MRR, NDCG, Recall |
| PDF parsing | `pdfplumber` / `pypdf` |
| QA generation | OpenRouter API (`openai` SDK) |
| System metrics | `psutil` (CPU/RAM), `pynvml` (NVIDIA), `rocm-smi` (AMD) |
| Charts | Recharts |

---

## Prerequisites

- **Python 3.8+**
- **Node.js 16+** and npm
- **OpenRouter API key** — for QA pair generation ([openrouter.ai](https://openrouter.ai))
- **Ollama** — for the LLM metrics tab ([ollama.com](https://ollama.com))

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/naku2001/Metrics.git
cd ai-benchmarking-dashboard
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Configure environment variables

Create a `.env` file in the project root:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=anthropic/claude-3-haiku
```

> The API key can also be entered via the Settings panel in the UI — it will be written to `.env` automatically.

---

## Running

### Option A — Unified launcher (recommended)

```bash
python start.py
```

Starts both the FastAPI backend and the Vite dev server in parallel with colored log output. Press `Ctrl+C` to stop both.

### Option B — Separate terminals

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Then open **http://localhost:5173** in your browser.

> The Vite dev server proxies all `/api/*` requests to `http://localhost:8000`.

---

## Ollama Setup

The LLM metrics tab communicates directly with Ollama from the browser. Ollama must be started with CORS enabled:

```bash
OLLAMA_ORIGINS=* ollama serve
```

Install models beforehand, for example:

```bash
ollama pull llama3.2
ollama pull mistral
ollama pull phi3
```

---

## Project Structure

```
/
├── backend/
│   ├── main.py             # FastAPI app — all API endpoints
│   ├── hardware.py         # Hardware detection and system metrics
│   ├── chunker.py          # PDF loading and text chunking
│   ├── qa_generator.py     # OpenRouter QA pair generation (streaming)
│   ├── embedder.py         # Embedding models, cosine search, t-SNE
│   ├── benchmarker.py      # ranx scoring and per-chunk result building
│   └── cache/              # Cached QA pairs, keyed by PDF hash (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                        # Root — tab routing, hardware fetch, settings
│   │   ├── tabs/
│   │   │   ├── EmbeddingBenchmark.jsx     # Embedding pipeline UI
│   │   │   └── OllamaMetrics.jsx          # Ollama LLM benchmark UI
│   │   └── components/
│   │       ├── ProgressSteps.jsx          # Step indicator
│   │       ├── MetricsTable.jsx           # Metric comparison table
│   │       ├── ChunkBreakdown.jsx         # Per-chunk retrieval breakdown
│   │       ├── TsnePlot.jsx               # t-SNE scatter plot (Recharts)
│   │       ├── SystemGauges.jsx           # RAM / CPU / VRAM gauges
│   │       ├── ModelSummaryCard.jsx       # LLM metrics card
│   │       ├── HardwareBadge.jsx          # Hardware mode badge
│   │       └── SettingsPanel.jsx          # Settings drawer
│   ├── vite.config.js       # Vite config with /api proxy
│   └── tailwind.config.js   # Custom dark theme color palette
├── .env                     # API keys (never commit)
├── requirements.txt         # Python dependencies
├── start.py                 # Unified launcher
└── CLAUDE.md                # Project spec
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hardware` | Auto-detected hardware profile |
| `GET` | `/api/system-metrics` | Live RAM, CPU, VRAM readings |
| `GET` | `/api/models/status` | HF Hub local cache status per model |
| `POST` | `/api/upload` | Upload PDF → extract text and create chunks |
| `POST` | `/api/generate-qa` | Generate QA pairs via OpenRouter (SSE stream) |
| `POST` | `/api/benchmark` | Run embedding benchmark (SSE stream) |
| `DELETE` | `/api/cache` | Clear all cached QA pair files |
| `POST` | `/api/settings/key` | Save OpenRouter API key to `.env` |

Streaming endpoints send newline-delimited `data: {...}` SSE events. See the source for event schemas.

Interactive API docs are available at **http://localhost:8000/docs** while the backend is running.

---

## Supported Embedding Models

| Model | Size | Notes |
|---|---|---|
| `sentence-transformers/all-MiniLM-L6-v2` | ~80 MB | Fast, good general baseline |
| `BAAI/bge-small-en-v1.5` | ~130 MB | Strong small English model |
| `BAAI/bge-large-en-v1.5` | ~1.3 GB | High accuracy, slower |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | ~420 MB | Multilingual |
| `intfloat/e5-small-v2` | ~130 MB | Efficient E5 family |
| `intfloat/multilingual-e5-large` | ~2.2 GB | Large multilingual model |

Models are downloaded from HuggingFace Hub on first use and stored in the standard HF cache directory (`~/.cache/huggingface/hub`).

---

## Metrics Reference

### Embedding Benchmark

| Metric | Description |
|---|---|
| **MRR** | Mean Reciprocal Rank — average of 1/rank of first relevant result |
| **Recall@K** | Fraction of relevant chunks retrieved in top K results |
| **NDCG@K** | Normalized Discounted Cumulative Gain at K — measures ranking quality |

All metrics are calculated by **ranx** using the synthetic QA pairs as ground truth.

### LLM Metrics

| Metric | Description |
|---|---|
| **TPS** | Tokens per second — `eval_count / (eval_duration / 1e9)` |
| **Prefill TPS** | Tokens per second during prompt processing |
| **TTFT** | Time to first token — measured client-side in milliseconds |
| **Load time** | Model load duration from first prompt's `load_duration` field |

---

## Configuration

| Setting | Where | Key |
|---|---|---|
| OpenRouter API key | Settings panel / `.env` | `OPENROUTER_API_KEY` |
| OpenRouter model | Settings panel / `.env` | `OPENROUTER_MODEL` |
| Ollama base URL | Settings panel | `localStorage: ollama_base_url` |
| Hardware mode override | Settings panel | `localStorage: hardware_mode_override` |
| Custom prompts | Prompts editor | `localStorage: ollama_prompts` |

---

## Notes

- The `.env` file and `backend/cache/` directory are gitignored and should never be committed
- QA generation requires an OpenRouter API key; the embedding benchmark and Ollama tab do not
- Large embedding models (e.g. `bge-large`, `multilingual-e5-large`) require significant disk space and RAM
- Embedding inference runs entirely on local hardware — no API calls during benchmarking
- The Ollama tab makes requests directly from the browser to `localhost:11434`, so Ollama must be running with `OLLAMA_ORIGINS=*`

---
## Screenshots

![Embedding Benchmark](image1.png)
![Ollama Metrics](assets/image2.png)

## License

MIT
