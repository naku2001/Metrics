# AI Benchmarking Dashboard

A local web app with two tabs: Embedding Benchmark and Ollama LLM Metrics.

## Stack
- **Frontend:** React + Vite + Tailwind CSS (dark theme only)
- **Backend:** FastAPI (Python)
- **Retrieval metrics:** `ranx` library — use this for all MRR, Recall@K, NDCG@K calculations, no custom implementations
- **PDF parsing:** `pypdf` or `pdfplumber` for text extraction
- **Embeddings:** `sentence-transformers` library
- **QA generation:** Anthropic API (`claude-sonnet-4-20250514`, max_tokens 1000)
- **Ollama:** local REST API at `http://localhost:11434`
- **System metrics:** `psutil` for RAM and CPU — `pynvml` for NVIDIA VRAM — `pyamdgpu` or `rocm-smi` subprocess for AMD VRAM

## Project Structure
```
/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── tabs/
│   │   │   ├── EmbeddingBenchmark.jsx
│   │   │   └── OllamaMetrics.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── vite.config.js
├── backend/
│   ├── main.py             # FastAPI entry point
│   ├── chunker.py          # PDF loading and text chunking
│   ├── qa_generator.py     # Anthropic API QA pair generation
│   ├── embedder.py         # sentence-transformers embedding
│   ├── benchmarker.py      # ranx scoring
│   ├── hardware.py         # hardware detection and metrics collection
│   └── cache/              # cached qa_pairs.json files (gitignored)
├── .env                    # ANTHROPIC_API_KEY (never commit)
├── requirements.txt
└── CLAUDE.md
```

## Run Commands
```bash
# Backend
cd backend && uvicorn main:app --reload --port 8000

# Frontend
cd frontend && npm run dev
```

## Hardware Detection

### Backend — `hardware.py`
On startup, auto-detect the hardware profile and expose it via `GET /api/hardware`. Never hardcode the hardware type anywhere else — always derive UI behaviour from this endpoint.

Detection logic (in priority order):
1. Check for NVIDIA GPU — try `import pynvml; pynvml.nvmlInit()`. If it succeeds → `gpu_vendor: "nvidia"`
2. Check for AMD GPU — try running `rocm-smi --showmeminfo vram --json` as a subprocess. If exit code 0 → `gpu_vendor: "amd"`
3. Otherwise → `gpu_vendor: null`, `mode: "cpu"`

Response shape:
```json
{
  "mode": "cpu" | "nvidia" | "amd",
  "gpu_vendor": null | "nvidia" | "amd",
  "gpu_name": null | "RTX 4090" | "RX 7900 XTX",
  "vram_total_gb": null | 12.0,
  "ram_total_gb": 32.0,
  "cpu_name": "AMD Ryzen 9 5900X",
  "cpu_cores": 12
}
```

### Frontend — Settings Panel
- On load, fetch `/api/hardware` and display a **Hardware badge** in the settings panel: "CPU only", "NVIDIA GPU", or "AMD GPU"
- Show GPU name and VRAM total if detected
- Allow the user to **manually override** the detected mode via a toggle: CPU / NVIDIA / AMD
- Persist the override in `localStorage` under key `hardware_mode_override`
- Send the active mode as a header `X-Hardware-Mode` on all benchmark API requests so the backend uses the correct metrics path

## Tab 1 — Embedding Benchmark

### Pipeline (in order)
1. User uploads a PDF → backend extracts text
2. Chunk into ~300-word segments with 50-word overlap
3. Generate 3 synthetic questions per chunk via Anthropic API — cache result to `backend/cache/<pdf_hash>_qa_pairs.json`
4. User selects one or more models from the preset list
5. Embed chunks + questions using `sentence-transformers`
6. Cosine similarity search per question over chunk embeddings
7. Score with `ranx`: MRR, Recall@1/3/5/10, NDCG@1/3/5/10

### Preset model list (do not add others unless asked)
- `all-MiniLM-L6-v2`
- `BAAI/bge-small-en-v1.5`
- `BAAI/bge-large-en-v1.5`
- `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- `intfloat/e5-small-v2`
- `intfloat/multilingual-e5-large`

### UI elements (all required)
- Live step-by-step progress indicator: Extracting → Chunking → Generating QA → Embedding → Scoring
- Metrics table — models as columns, metrics as rows
- Bar chart — NDCG@10 comparison across models (use Recharts)
- Per-chunk breakdown — expandable rows: chunk text, questions, which model retrieved it and at what rank
- t-SNE scatter plot of chunk embeddings, colored by cluster, chunk text on hover

### Caching rule
If `backend/cache/<pdf_hash>_qa_pairs.json` exists, skip QA generation and load from file. Always show the user whether cache was used.

## Tab 2 — Ollama LLM Metrics

### On load
- Fetch `GET http://localhost:11434/api/tags` to list installed models
- Fetch `GET /api/hardware` to determine active hardware mode
- Populate model selector from Ollama response — do not hardcode model names

### Hardware-aware behaviour
The UI and backend metrics collection adapt based on the active hardware mode:

| | CPU mode | NVIDIA mode | AMD mode |
|---|---|---|---|
| Expected TPS (7B) | 2–8 t/s | 40–100 t/s | 30–80 t/s |
| Chart Y-axis max | 15 | 120 | 100 |
| VRAM gauge | hidden | shown (pynvml) | shown (rocm-smi) |
| RAM gauge | shown | shown | shown |
| Load time card | prominent | standard | standard |
| GPU metrics tool | — | `pynvml` | `rocm-smi` subprocess |

Always read the active mode from `X-Hardware-Mode` header on incoming requests — never hardcode assumptions.

### Benchmark flow
- User picks one or more models → clicks Run Benchmark
- Send 5 fixed test prompts per model (one short factual, one long reasoning, one creative, one code generation, one summarisation)
- Parse response fields: `eval_count`, `eval_duration`, `prompt_eval_count`, `prompt_eval_duration`, `load_duration`, `total_duration`
- Calculate: TPS = `eval_count / (eval_duration / 1e9)`, Prefill TPS = `prompt_eval_count / (prompt_eval_duration / 1e9)`, TTFT measured client-side via streaming
- Poll `/api/system-metrics` every 2 seconds during benchmark — backend returns the correct fields for the active mode

### System metrics endpoint — `GET /api/system-metrics`
Always return RAM and CPU. Return VRAM only if the active mode has a GPU:
```json
{
  "ram_used_gb": 10.2,
  "ram_total_gb": 32.0,
  "ram_percent": 31.9,
  "cpu_percent": 45.2,
  "cpu_per_core": [40, 55, 30, 48],
  "vram_used_gb": 8.1,   // null if CPU mode
  "vram_total_gb": 12.0, // null if CPU mode
  "vram_percent": 67.5   // null if CPU mode
}
```

### UI elements (all required)
- Summary card per model: avg TPS, avg TTFT, avg RAM usage, model load time, model size, quantization — add avg VRAM usage if GPU mode active
- Grouped bar chart: TPS and TTFT across models (use Recharts) — Y-axis max scales to hardware mode
- Live RAM and CPU gauges — always visible, updated every 2 seconds during benchmark
- Live VRAM gauge — visible only when GPU mode is active
- Per-prompt results table for each model
- Live token stream preview during generation
- Persistent notice: Ollama must run with `OLLAMA_ORIGINS=*` — include copy-paste command

## Settings Panel
- Input for `ANTHROPIC_API_KEY` (stored in `.env`, never in frontend)
- Input for Ollama base URL (default `http://localhost:11434`)
- **Hardware badge** — shows auto-detected mode (CPU / NVIDIA GPU / AMD GPU) with GPU name if found
- **Hardware override toggle** — CPU / NVIDIA / AMD — persisted in `localStorage`
- Clear cache button

## UI Rules
- Dark theme throughout — no light mode toggle
- Loading skeletons while any data is fetching
- Error states with clear human-readable messages (e.g. "Ollama is not running", "Anthropic API key missing", "AMD GPU detected but rocm-smi not found — falling back to CPU mode")
- Recharts for all charts — do not use Chart.js or D3 unless Recharts cannot do it

## API Key Handling
- `ANTHROPIC_API_KEY` lives in `backend/.env` only
- Never expose it to the frontend
- All Anthropic API calls go through the FastAPI backend
- Ollama calls can be made directly from the frontend (CORS handled by Ollama)

## Do Not
- Do not implement custom MRR/NDCG logic — always use `ranx`
- Do not add models to the preset list without being asked
- Do not commit `.env` or anything in `backend/cache/`
- Do not use a light theme anywhere
- Do not hardcode hardware assumptions anywhere — always derive from `/api/hardware` or the `X-Hardware-Mode` header
- Do not show VRAM fields in CPU mode
- Do not use GPU-range TPS scales in CPU mode — use the hardware mode table above for chart scaling
