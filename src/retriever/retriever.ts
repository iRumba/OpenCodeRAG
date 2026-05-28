import type { EmbeddingProvider, VectorStore, SearchResult } from "../core/interfaces.js";

export interface RetrieveOptions {
  topK?: number;
}

export async function retrieve(
  query: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  options: RetrieveOptions = {}
): Promise<SearchResult[]> {
  const topK = options.topK ?? 10;

  const embeddings = await embedder.embed([query]);
  const embedding = embeddings[0];
  if (!embedding || embedding.length === 0) {
    return [];
  }

  // If the provider returned text (string[][]) instead of numeric vectors,
  // bail out — we can't perform a vector search without numeric embeddings.
  if (typeof embedding[0] !== "number") {
    return [];
  }

  return store.search(embedding as number[], topK);
}
