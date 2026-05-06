/**
 * Cosine-similarity ranking for the gallery's semantic-search fallback.
 *
 * Each Asset carries a 1536-dim text-embedding-3-small vector under
 * `Asset.embedding` (written at generation time by the /api/embed route).
 * When the user's substring search yields zero hits, we embed the query
 * with the same model and rank assets by cosine similarity here. Pure
 * math + ranking; the network call lives in app/page.tsx.
 *
 * No external dependencies — JS-numeric loops are plenty fast for the
 * project sizes we expect (a few hundred vectors max).
 */

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type Ranked<T> = T & { _score: number };

/** Returns items sorted by cosine similarity to `queryVec`, descending.
 *  Items without an embedding (or with a length mismatch) are dropped.
 *  `minScore` filters weak matches; `topK` caps the result list. */
export function rankBySimilarity<T extends { embedding?: number[] }>(
  items: T[],
  queryVec: number[],
  opts: { topK?: number; minScore?: number } = {}
): Array<Ranked<T>> {
  const topK = opts.topK ?? 24;
  const minScore = opts.minScore ?? 0.25;
  const scored: Ranked<T>[] = [];
  for (const it of items) {
    if (!Array.isArray(it.embedding) || it.embedding.length !== queryVec.length) continue;
    const s = cosineSim(it.embedding, queryVec);
    if (s >= minScore) scored.push({ ...it, _score: s });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, topK);
}
