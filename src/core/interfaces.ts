export interface Chunk {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
  };
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export interface Chunker {
  readonly language: string;
  readonly fileExtensions?: string[];
  chunk(filePath: string, content: string): Promise<Chunk[]>;
}

export interface EmbeddingProvider {
  readonly name: string;
  // The provider may return numeric embeddings (`number[][]`) or,
  // in some configurations (e.g. Ollama text-only mode), the original
  // texts as `string[][]`. Consumers must handle both shapes.
  embed(texts: string[]): Promise<number[][] | string[][]>;
}

export interface VectorStore {
  addChunks(chunks: Chunk[]): Promise<void>;
  search(embedding: number[], topK: number): Promise<SearchResult[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  deleteByFilePath(filePath: string): Promise<void>;
}
