from ranx import Qrels, Run, evaluate


def score_retrieval(
    qa_pairs: list,
    search_results: list,
    chunk_ids: list,
) -> dict:
    """
    Compute MRR, Recall@K, NDCG@K using ranx.

    Args:
        qa_pairs:       list of {chunk_id, questions: [...]}
        search_results: flat list, one entry per question — each entry is
                        [{corpus_idx, score}, ...] sorted by descending score
        chunk_ids:      ordered list of corpus chunk IDs

    Returns:
        dict of metric_name → float
    """
    qrels_dict: dict[str, dict[str, int]] = {}
    run_dict: dict[str, dict[str, float]] = {}

    q_idx = 0
    for qa in qa_pairs:
        relevant = qa["chunk_id"]
        for question in qa["questions"]:
            q_id = f"q_{q_idx}"
            qrels_dict[q_id] = {relevant: 1}

            ranked: dict[str, float] = {}
            for hit in search_results[q_idx]:
                cid = chunk_ids[hit["corpus_idx"]]
                # Use score as the run value; ranx handles ranking internally
                ranked[cid] = float(hit["score"])
            run_dict[q_id] = ranked
            q_idx += 1

    qrels = Qrels(qrels_dict)
    run = Run(run_dict)

    raw = evaluate(
        qrels,
        run,
        [
            "mrr",
            "recall@1", "recall@3", "recall@5", "recall@10",
            "ndcg@1",   "ndcg@3",   "ndcg@5",   "ndcg@10",
        ],
    )
    return {k: round(float(v), 4) for k, v in raw.items()}


def build_per_chunk_results(
    qa_pairs: list,
    search_results: list,
    chunk_ids: list,
) -> list:
    """
    Build per-chunk retrieval detail for the UI breakdown table.
    Returns list of:
        {
          chunk_id, chunk_text,
          questions: [{question, retrieved_chunk_id, rank, score, correct}, ...]
        }
    """
    detailed = []
    q_idx = 0

    for qa in qa_pairs:
        questions_detail = []
        for question in qa["questions"]:
            hits = search_results[q_idx]
            # Find rank of ground-truth chunk
            rank = None
            top_hit = hits[0] if hits else None
            for r, hit in enumerate(hits, start=1):
                if chunk_ids[hit["corpus_idx"]] == qa["chunk_id"]:
                    rank = r
                    break

            questions_detail.append(
                {
                    "question": question,
                    "retrieved_chunk_id": chunk_ids[top_hit["corpus_idx"]] if top_hit else None,
                    "rank": rank,
                    "score": float(top_hit["score"]) if top_hit else 0.0,
                    "correct": rank == 1,
                }
            )
            q_idx += 1

        detailed.append(
            {
                "chunk_id": qa["chunk_id"],
                "chunk_text": qa["chunk_text"],
                "questions": questions_detail,
            }
        )

    return detailed
