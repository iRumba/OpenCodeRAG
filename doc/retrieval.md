# Retrieval

## Pipeline

The retrieval pipeline (`src/retriever/retriever.ts`) converts natural language queries into ranked code chunks:

```
User Query
    │
    ├──> Prefix with queryPrefix (e.g., "search_query: ")
    │
    ├──> embed() ──> Vector Search ──> topK × 3 results
    │
    ├──> KeywordIndex.search() ──> topK × 3 results (if hybrid enabled)
    │
    └──> Weighted Fusion
              │
         Filter by minScore
              │
         Sort by score (desc)
              │
         Slice to topK
              │
         Return SearchResult[]
```

## Hybrid Search (Keyword + Vector)

When `retrieval.hybridSearch.enabled` is `true` (default), both searches run and results are fused.

### Keyword Search
The `KeywordIndex` (`src/retriever/keyword-index.ts`) is a zero-dependency inverted index:

- **Tokenizer:** Handles CamelCase, snake_case, and code-specific special characters
- **Scoring:** TF×IDF — term frequency within a chunk × log of inverse document frequency
- **Storage:** Serialized to `${storePath}/keyword-index.json` alongside manifest.json

### Score Fusion

Results are merged via weighted combination:

```
score = (1 - kw) * vScore + kw * kScore
```

Where:
- `kw` = `retrieval.hybridSearch.keywordWeight` (default 0.4)
- `vScore` = vector similarity score (0–1)
- `kScore` = keyword TF×IDF score, normalized by top keyword result

Low-scoring chunks that don't meet `minScore` are filtered out.

### `retrieve()` API

```typescript
async function retrieve(
  query: string,           // Natural language query
  embedder: EmbeddingProvider,
  store: VectorStore,
  options?: RetrieveOptions
): Promise<SearchResult[]>
```

Options:

| Option | Default | Description |
|---|---|---|
| `topK` | `10` | Max results |
| `minScore` | `0` | Minimum relevance threshold |
| `keywordIndex` | — | Keyword index instance |
| `keywordWeight` | `0.4` | Hybrid fusion weight |
| `queryPrefix` | — | Prefix applied to query before embedding |

## Vector Search

Vector search uses LanceDB's native ANN (Approximate Nearest Neighbor) index. The query text is:

1. Prefixed with `queryPrefix` (e.g., `"search_query: "`)
2. Embedded via the configured provider
3. Searched against the LanceDB store

The vector search multiplier (`vectorFactor = 3`) returns 3× the `topK` results to allow the hybrid fusion to consider more candidates.

## Description-Based Embedding

When `description.enabled` is `true`, the embedded text for each chunk is:

```
[description] + "\n\n" + [code content]
```

This captures both semantic meaning (from the description) and code-level similarity (from the code itself). Keyword search always uses the raw code content regardless of this setting.

See [Configuration](configuration.md#description) for details.

## Caching

The plugin maintains a **session-level retrieval cache** that avoids re-embedding repeated queries within the same session. This cache is ephemeral and does not persist across sessions.

## Code Autocomplete Integration

Preparing for `processAutocompleteRequest`: The architecture is designed to support autocomplete-time retrieval, allowing relevant code context to be injected at cursor position. This is planned for a future release.

## Future Improvements

| Feature | Status | Description |
|---|---|---|
| LLM-based re-ranking | Planned | Cross-encoder after vector search for precision |
| Query rewriting | Planned | Multi-variant query expansion |
| Context optimization | Planned | Dedup, merge adjacent chunks, diversity ranking |
| Retrieval explainability | Planned | Debug surfaces for why chunks were returned |
| Cross-file graph | Planned | Dependency-aware search via import/call graphs |
