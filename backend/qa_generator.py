import json
import os
from pathlib import Path
from typing import AsyncGenerator

CACHE_DIR = Path(__file__).parent / "cache"

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "anthropic/claude-3-haiku"


def _cache_path(pdf_hash: str) -> Path:
    return CACHE_DIR / f"{pdf_hash}_qa_pairs.json"


def _load_cache(pdf_hash: str):
    path = _cache_path(pdf_hash)
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return None


def _save_cache(pdf_hash: str, qa_pairs: list):
    CACHE_DIR.mkdir(exist_ok=True)
    with open(_cache_path(pdf_hash), "w") as f:
        json.dump(qa_pairs, f, indent=2)


async def generate_qa_pairs_streaming(
    chunks: list, pdf_hash: str
) -> AsyncGenerator[dict, None]:
    """
    Async generator that yields progress dicts and finally a completion dict.
    Yields:
        {"type": "cached",   "qa_pairs": [...]}        — if loaded from cache
        {"type": "progress", "done": n, "total": N}    — while generating
        {"type": "done",     "qa_pairs": [...]}         — when complete
    """
    cached = _load_cache(pdf_hash)
    if cached is not None:
        yield {"type": "cached", "qa_pairs": cached}
        return

    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY is not set. Add it via Settings.")

    model = os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)

    from openai import OpenAI

    client = OpenAI(
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
    )

    qa_pairs = []
    total = len(chunks)

    for i, chunk in enumerate(chunks):
        prompt = (
            "Given the following text passage, generate exactly 3 diverse questions "
            "that can be answered solely from this passage. "
            "Return ONLY a JSON array of 3 question strings, no other text.\n\n"
            f"Passage:\n{chunk['text']}\n\nJSON:"
        )
        response = client.chat.completions.create(
            model=model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.choices[0].message.content.strip()
        questions = _parse_questions(raw)
        qa_pairs.append(
            {
                "chunk_id": chunk["id"],
                "chunk_text": chunk["text"],
                "questions": questions,
            }
        )
        yield {"type": "progress", "done": i + 1, "total": total}

    _save_cache(pdf_hash, qa_pairs)
    yield {"type": "done", "qa_pairs": qa_pairs}


def _parse_questions(raw: str) -> list:
    # Strip optional markdown code block
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            stripped = part.strip()
            if stripped.startswith("[") or stripped.startswith("json"):
                raw = stripped.lstrip("json").strip()
                break
    try:
        questions = json.loads(raw)
        if isinstance(questions, list):
            return [str(q) for q in questions[:3]]
    except Exception:
        pass
    lines = [l.strip().lstrip("0123456789.-) ") for l in raw.splitlines() if l.strip()]
    return lines[:3] or ["What does this passage discuss?"]
