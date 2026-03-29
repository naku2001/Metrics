import os
import asyncio
import json
from pathlib import Path
from typing import AsyncGenerator, List, Optional

import numpy as np

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(Path(__file__).parent.parent / ".env")

from hardware import detect_hardware, get_system_metrics
from chunker import load_and_chunk_pdf
from qa_generator import generate_qa_pairs_streaming
from embedder import cosine_similarity_search, compute_tsne, embed_ollama_batched, is_model_cached, load_model
from benchmarker import score_retrieval, build_per_chunk_results

app = FastAPI(title="AI Benchmarking Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_hw: dict = {}


@app.on_event("startup")
async def startup():
    global _hw
    _hw = detect_hardware()


# ---------------------------------------------------------------------------
# Hardware & system metrics
# ---------------------------------------------------------------------------

@app.get("/api/hardware")
def hardware():
    return _hw


@app.get("/api/system-metrics")
def system_metrics(x_hardware_mode: Optional[str] = Header(default=None)):
    mode = x_hardware_mode or _hw.get("mode", "cpu")
    return get_system_metrics(mode)


# ---------------------------------------------------------------------------
# PDF upload → extract + chunk (fast, non-streaming)
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")
    data = await file.read()
    try:
        pdf_hash, chunks = load_and_chunk_pdf(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {"pdf_hash": pdf_hash, "chunks": chunks, "chunk_count": len(chunks)}


# ---------------------------------------------------------------------------
# QA generation — streaming SSE
# ---------------------------------------------------------------------------

@app.post("/api/generate-qa")
async def generate_qa(request: dict):
    """
    Body: {"pdf_hash": str, "chunks": [...]}
    Streams SSE events:
      data: {"type": "cached",   "qa_pairs": [...]}
      data: {"type": "progress", "done": n, "total": N}
      data: {"type": "done",     "qa_pairs": [...]}
      data: {"type": "error",    "message": "..."}
    """
    pdf_hash = request.get("pdf_hash", "")
    chunks = request.get("chunks", [])

    async def stream() -> AsyncGenerator[str, None]:
        try:
            async for event in generate_qa_pairs_streaming(chunks, pdf_hash):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Embedding benchmark — streaming SSE
# ---------------------------------------------------------------------------

PRESET_MODELS = [
    "sentence-transformers/all-MiniLM-L6-v2",
    "BAAI/bge-small-en-v1.5",
    "BAAI/bge-large-en-v1.5",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "intfloat/e5-small-v2",
    "intfloat/multilingual-e5-large",
]


@app.get("/api/models/status")
def models_status():
    """Return local cache status for every preset embedding model."""
    return [{"model": m, "cached": is_model_cached(m)} for m in PRESET_MODELS]


class BenchmarkRequest(BaseModel):
    pdf_hash: str
    models: List[str]
    chunks: List[dict]
    qa_pairs: List[dict]
    embedding_source: str = "huggingface"   # "huggingface" | "ollama"
    ollama_base_url: str = "http://localhost:11434"


@app.post("/api/benchmark")
async def run_benchmark(
    req: BenchmarkRequest,
    x_hardware_mode: Optional[str] = Header(default=None),
):
    """
    Streams SSE events:
      data: {"type": "step",     "step": "embedding", "model": "...", "idx": n, "total": N}
      data: {"type": "step",     "step": "scoring",   "model": "..."}
      data: {"type": "step",     "step": "tsne"}
      data: {"type": "model_done", "model": "...", "metrics": {...}}
      data: {"type": "done",     "results": {...}, "tsne": {...}}
      data: {"type": "error",    "message": "..."}
    """
    chunk_texts = [c["text"] for c in req.chunks]
    chunk_ids = [c["id"] for c in req.chunks]

    all_questions: List[str] = []
    for qa in req.qa_pairs:
        all_questions.extend(qa["questions"])

    BATCH = 32
    use_ollama = req.embedding_source == "ollama"

    async def _embed_texts(model_name: str, texts: List[str], phase: str):
        """Embed texts and stream per-batch progress. Yields SSE strings then final ndarray."""
        batches: List[np.ndarray] = []
        loop = asyncio.get_event_loop()

        if use_ollama:
            async for done, tot, result in embed_ollama_batched(texts, model_name, req.ollama_base_url, BATCH):
                if result is not None:
                    batches.append(result)
                else:
                    yield f"data: {json.dumps({'type': 'embed_progress', 'phase': phase, 'done': done, 'total': tot, 'model': model_name})}\n\n"
        else:
            # Check cache and emit a downloading step if the model isn't local yet
            cached = await loop.run_in_executor(None, lambda: is_model_cached(model_name))
            if not cached:
                yield f"data: {json.dumps({'type': 'step', 'step': 'downloading', 'model': model_name})}\n\n"

            # Load (or download) the model in a thread so the event loop stays free
            model = await loop.run_in_executor(None, lambda: load_model(model_name))

            # Encode batch-by-batch, yielding real-time progress between batches
            total = len(texts)
            for i in range(0, total, BATCH):
                batch = texts[i: i + BATCH]
                embs = await loop.run_in_executor(
                    None,
                    lambda b=batch: np.array(
                        model.encode(b, normalize_embeddings=True, show_progress_bar=False),
                        dtype=np.float32,
                    ),
                )
                batches.append(embs)
                done = min(i + BATCH, total)
                yield f"data: {json.dumps({'type': 'embed_progress', 'phase': phase, 'done': done, 'total': total, 'model': model_name})}\n\n"

        yield np.vstack(batches) if batches else np.empty((0, 0), dtype=np.float32)

    async def stream() -> AsyncGenerator[str, None]:
        results: dict = {}
        tsne_data: Optional[dict] = None

        try:
            for idx, model_name in enumerate(req.models):
                yield f"data: {json.dumps({'type': 'step', 'step': 'embedding', 'model': model_name, 'idx': idx + 1, 'total': len(req.models)})}\n\n"

                # --- embed chunks ---
                chunk_embs = None
                async for item in _embed_texts(model_name, chunk_texts, "chunks"):
                    if isinstance(item, str):
                        yield item
                    else:
                        chunk_embs = item

                # --- embed questions ---
                q_embs = None
                async for item in _embed_texts(model_name, all_questions, "questions"):
                    if isinstance(item, str):
                        yield item
                    else:
                        q_embs = item

                # --- scoring ---
                yield f"data: {json.dumps({'type': 'step', 'step': 'scoring', 'model': model_name})}\n\n"
                search_results = cosine_similarity_search(q_embs, chunk_embs)
                metrics = score_retrieval(req.qa_pairs, search_results, chunk_ids)
                per_chunk = build_per_chunk_results(req.qa_pairs, search_results, chunk_ids)

                results[model_name] = {"metrics": metrics, "per_chunk": per_chunk}
                yield f"data: {json.dumps({'type': 'model_done', 'model': model_name, 'metrics': metrics})}\n\n"

                # --- t-SNE (first model only) ---
                if tsne_data is None:
                    yield f"data: {json.dumps({'type': 'step', 'step': 'tsne'})}\n\n"
                    coords, labels = await asyncio.to_thread(compute_tsne, chunk_embs)
                    tsne_data = {"coords": coords, "labels": labels, "chunk_texts": chunk_texts}

            yield f"data: {json.dumps({'type': 'done', 'results': results, 'tsne': tsne_data})}\n\n"

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Cache management
# ---------------------------------------------------------------------------

@app.delete("/api/cache")
def clear_cache():
    cache_dir = Path(__file__).parent / "cache"
    deleted = 0
    for f in cache_dir.glob("*.json"):
        f.unlink()
        deleted += 1
    return {"deleted": deleted}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class ApiKeyRequest(BaseModel):
    key: str
    model: Optional[str] = None


@app.post("/api/settings/key")
def save_api_key(req: ApiKeyRequest):
    env_path = Path(__file__).parent.parent / ".env"
    lines: list[str] = []
    if env_path.exists():
        with open(env_path) as f:
            lines = f.readlines()

    def _upsert(lines, var, value):
        for i, line in enumerate(lines):
            if line.startswith(f"{var}="):
                lines[i] = f"{var}={value}\n"
                return lines
        lines.append(f"{var}={value}\n")
        return lines

    lines = _upsert(lines, "OPENROUTER_API_KEY", req.key)
    if req.model:
        lines = _upsert(lines, "OPENROUTER_MODEL", req.model)

    with open(env_path, "w") as f:
        f.writelines(lines)

    os.environ["OPENROUTER_API_KEY"] = req.key
    if req.model:
        os.environ["OPENROUTER_MODEL"] = req.model
    return {"ok": True}

