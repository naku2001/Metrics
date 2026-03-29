import hashlib
import io


def load_and_chunk_pdf(file_bytes: bytes, word_size: int = 300, overlap: int = 50):
    """
    Extract text from PDF bytes and split into overlapping word-based chunks.
    Returns (pdf_hash, chunks) where each chunk is:
        {"id": "chunk_N", "text": "...", "word_start": int, "word_end": int}
    """
    text = _extract_text(file_bytes)
    pdf_hash = hashlib.md5(file_bytes).hexdigest()
    chunks = _chunk_words(text, word_size, overlap)
    return pdf_hash, chunks


def _extract_text(file_bytes: bytes) -> str:
    # Try pypdf first
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages).strip()
        if text:
            return text
    except Exception:
        pass

    # Fall back to pdfplumber
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        return "\n".join(pages).strip()
    except Exception as exc:
        raise ValueError(f"Could not extract text from PDF: {exc}") from exc


def _chunk_words(text: str, word_size: int, overlap: int) -> list:
    words = text.split()
    if not words:
        return []

    chunks = []
    step = word_size - overlap
    i = 0
    idx = 0

    while i < len(words):
        chunk_words = words[i: i + word_size]
        chunks.append(
            {
                "id": f"chunk_{idx}",
                "text": " ".join(chunk_words),
                "word_start": i,
                "word_end": i + len(chunk_words),
            }
        )
        i += step
        idx += 1

    return chunks
