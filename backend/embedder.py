import threading
from typing import List

import numpy as np

# ---------------------------------------------------------------------------
# In-memory model cache — avoids reloading the same model across requests
# ---------------------------------------------------------------------------
_model_cache: dict = {}
_model_lock = threading.Lock()


def is_model_cached(model_name: str) -> bool:
    """Return True if the model's files are already in the local HF Hub cache."""
    try:
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir()
        for repo in info.repos:
            if repo.repo_id == model_name:
                return True
        # Handle bare name like 'all-MiniLM-L6-v2' → 'sentence-transformers/all-MiniLM-L6-v2'
        if "/" not in model_name:
            for repo in info.repos:
                if repo.repo_id == f"sentence-transformers/{model_name}":
                    return True
        return False
    except Exception:
        return False


def load_model(model_name: str):
    """
    Load a SentenceTransformer model, downloading from HuggingFace Hub if not
    already cached. The loaded model is kept in memory for reuse.
    """
    from sentence_transformers import SentenceTransformer
    with _model_lock:
        if model_name not in _model_cache:
            _model_cache[model_name] = SentenceTransformer(model_name)
        return _model_cache[model_name]


def get_embeddings(texts: List[str], model_name: str) -> np.ndarray:
    """Embed texts using a cached local model. Returns L2-normalised embeddings."""
    model = load_model(model_name)
    embeddings = model.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=64,
    )
    return np.array(embeddings, dtype=np.float32)


def embed_batched(texts: List[str], model_name: str, batch_size: int = 32):
    """
    Sync generator that embeds texts in batches using a cached local model.
    Yields (done, total, None) for each batch processed.
    Final yield is (total, total, embeddings_array).
    """
    model = load_model(model_name)
    total = len(texts)
    batches: List[np.ndarray] = []

    for i in range(0, total, batch_size):
        batch = texts[i: i + batch_size]
        embs = model.encode(batch, normalize_embeddings=True, show_progress_bar=False)
        batches.append(np.array(embs, dtype=np.float32))
        done = min(i + batch_size, total)
        yield done, total, None

    result = np.vstack(batches) if batches else np.empty((0, 0), dtype=np.float32)
    yield total, total, result


async def embed_ollama_batched(
    texts: List[str],
    model_name: str,
    base_url: str = "http://localhost:11434",
    batch_size: int = 32,
):
    """
    Async generator that embeds texts via Ollama's /api/embed endpoint.
    Yields (done, total, None) for each batch, then (total, total, ndarray).
    Embeddings are L2-normalised before returning.
    """
    import httpx

    total = len(texts)
    all_embeddings: List[np.ndarray] = []

    async with httpx.AsyncClient(timeout=120) as client:
        for i in range(0, total, batch_size):
            batch = texts[i: i + batch_size]
            resp = await client.post(
                f"{base_url.rstrip('/')}/api/embed",
                json={"model": model_name, "input": batch},
            )
            resp.raise_for_status()
            vecs = np.array(resp.json()["embeddings"], dtype=np.float32)
            norms = np.linalg.norm(vecs, axis=1, keepdims=True)
            norms = np.where(norms == 0, 1.0, norms)
            all_embeddings.append(vecs / norms)
            done = min(i + batch_size, total)
            yield done, total, None

    result = np.vstack(all_embeddings) if all_embeddings else np.empty((0, 0), dtype=np.float32)
    yield total, total, result


def cosine_similarity_search(
    query_embeddings: np.ndarray,
    corpus_embeddings: np.ndarray,
    top_k: int = 10,
) -> List[List[dict]]:
    """
    For each query, return top_k corpus hits sorted by descending cosine similarity.
    Embeddings must be L2-normalised (dot product == cosine similarity).
    Returns list of lists: [[{"corpus_idx": int, "score": float}, ...], ...]
    """
    scores = query_embeddings @ corpus_embeddings.T
    k = min(top_k, corpus_embeddings.shape[0])

    results = []
    for row in scores:
        top_indices = np.argpartition(row, -k)[-k:]
        top_indices = top_indices[np.argsort(row[top_indices])[::-1]]
        results.append(
            [{"corpus_idx": int(idx), "score": float(row[idx])} for idx in top_indices]
        )
    return results


def compute_tsne(
    embeddings: np.ndarray,
    n_components: int = 2,
    perplexity: int = 30,
    n_clusters: int = 8,
) -> tuple:
    """
    Reduce embeddings to 2-D via t-SNE and cluster with KMeans.
    Returns (coords: list[list[float]], labels: list[int]).
    """
    from sklearn.cluster import KMeans
    from sklearn.manifold import TSNE

    n = embeddings.shape[0]
    if n < 2:
        return [[0.0, 0.0]] * n, [0] * n
    effective_perplexity = min(perplexity, n - 1)

    tsne = TSNE(
        n_components=n_components,
        perplexity=effective_perplexity,
        random_state=42,
        max_iter=1000,
    )
    coords = tsne.fit_transform(embeddings)

    k = min(n_clusters, n)
    labels = KMeans(n_clusters=k, random_state=42, n_init=10).fit_predict(embeddings)

    return coords.tolist(), labels.tolist()
