import type { EmbeddingProvider, KeywordIndex, VectorStore, SearchResult } from "../core/interfaces.js";

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  keywordIndex?: KeywordIndex;
  keywordWeight?: number;
  queryPrefix?: string;
}

export async function retrieve(
  query: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  options: RetrieveOptions = {}
): Promise<SearchResult[]> {
  const topK = options.topK ?? 10;
  const minScore = options.minScore ?? 0;

  const prefixedQuery = (options.queryPrefix ?? "") + query;
  const embeddings = await embedder.embed([prefixedQuery], "query");
  const embedding = embeddings[0];
  if (!embedding || embedding.length === 0) {
    return [];
  }

  if (typeof embedding[0] !== "number") {
    return [];
  }

  const vectorFactor = 3;
  const vectorResults = await store.search(embedding as number[], topK * vectorFactor);

  let keywordResults: SearchResult[] = [];
  if (options.keywordIndex) {
    keywordResults = options.keywordIndex.search(query, topK * vectorFactor);
  }

  if (keywordResults.length === 0) {
    return vectorResults.filter((r) => r.score >= minScore);
  }

  const kwTopScore = keywordResults.length > 0 ? keywordResults[0]!.score : 1;

  const combined = new Map<string, { chunk: SearchResult["chunk"]; vScore: number; kScore: number }>();

  for (const r of vectorResults) {
    combined.set(r.chunk.id, {
      chunk: r.chunk,
      vScore: r.score,
      kScore: 0,
    });
  }

  for (const r of keywordResults) {
    const existing = combined.get(r.chunk.id);
    if (existing) {
      existing.kScore = kwTopScore > 0 ? r.score / kwTopScore : 0;
    } else {
      combined.set(r.chunk.id, {
        chunk: r.chunk,
        vScore: 0,
        kScore: kwTopScore > 0 ? r.score / kwTopScore : 0,
      });
    }
  }

  const kw = options.keywordWeight ?? 0.4;
  const combinedResults: SearchResult[] = [...combined.values()]
    .map((entry) => ({
      chunk: entry.chunk,
      score: (1 - kw) * entry.vScore + kw * entry.kScore,
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return combinedResults;
}
