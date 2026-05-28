# 🛣️ Roadmap

## ✅ Completed (MVP)

- [x] AST-based code chunking (TypeScript, Python, Java, Go, Markdown + fallback)
- [x] Embedding providers (Ollama + OpenAI, factory-pattern dispatch)
- [x] Vector storage (LanceDB with `memory://` test mode)
- [x] Retrieval pipeline (embed → search → score → return)
- [x] CLI (index, query, clear, status via commander)
- [x] OpenCode plugin (chat.message hook, context injection)
- [x] Pluggable storage via `VectorStore` interface
- [x] Pluggable chunkers via `Chunker` interface
- [x] Pluggable embedders via `EmbeddingProvider` interface
- [x] JSON config with deep-merged partial overrides
- [x] Batch embedding (configurable batch size)
- [x] Test suite (60 tests, Node built-in runner)

## Short Term

- [x] Incremental indexing (file-hash-based, diff-aware)
- [x] File change watchers (auto-reindex on save)
- [ ] Hybrid search (BM25 keyword + vector)
- [ ] Query rewriting / multi-variant expansion
- [ ] Context window optimization (dedup, merge adjacent chunks)
- [x] AST chunking for more languages (Rust, Ruby, Kotlin, Swift, C, C++, C#, JavaScript, JSON, HTML, CSS, XML, Razor)

## Mid Term

- [ ] Cross-file relationship graph (imports, call graph)
- [ ] Dependency-aware search
- [ ] LLM-based re-ranking layer
- [ ] Multi-repo support
- [ ] IDE context awareness (current file, cursor position)
- [ ] Prompt template customization
- [ ] Debugging tools (inspecting embeddings, result explanations)

## Long Term

- [ ] Evaluation framework (benchmark queries, precision@K, recall)
- [ ] Code execution-aware retrieval
- [ ] Semantic refactoring assistant
- [ ] Agent-based code navigation
- [ ] Multi-modal support (diagrams, API specs, JSON schemas)
- [ ] Access control (per-folder permissions, sensitive file exclusion)

---

# 💡 Brainstorming: Future Enhancements

## 1. 🔁 Incremental Indexing + Watch Mode

Implemented with a manifest sidecar beside the LanceDB dataset. Indexing now
hashes files, skips unchanged files, updates modified files, removes deleted or
empty files, and safely rebuilds if the manifest is missing or corrupt while
the store already contains rows.

Watch mode (`index --watch`) uses chokidar to trigger debounced incremental
passes on add/change/unlink events. Passes are serialized — a queued follow-up
pass runs after the current pass finishes.

## 2. 🧠 Query Enhancement

Improve retrieval quality by expanding shorthand queries into multiple semantic
variants before searching.

## 3. 🔗 Code Graph Awareness

Build a structural understanding of the codebase: function call graphs, import
dependencies, class hierarchies. Enables "where is this function used?" and
"what depends on this module?" queries.

## 4. 📊 Re-ranking Layer

After vector search, use a cross-encoder or lightweight LLM to re-rank results.
Drastically improves precision for ambiguous queries.

## 5. 🧱 Hybrid Search (BM25 + Vector)

Combine exact keyword matching with semantic search. On codebases, function
names and type identifiers benefit from exact matching while natural language
queries benefit from vector search.

## 6. 🧾 Context Window Optimization

Prevent token overload by deduplicating similar chunks, merging adjacent
chunks, and ranking by diversity. Currently `maxContextChunks` limits the
count, but no quality filtering is applied.

## 7. 🧑‍💻 IDE/Editor Context Awareness

Integrate with the editor's current context — active file, cursor position,
selected code. Boosts retrieval relevance dramatically by weighting results
near the user's current focus.

## 8. 🧪 Evaluation Framework

Measure retrieval quality with benchmark queries, precision@K, and recall.
Needed before tuning chunking strategies or embedding models.

## 9. 🔐 Access Control

Per-folder permissions and sensitive file exclusion for enterprise or
multi-user environments.

## 10. 🧠 Caching Layer

Cache embeddings and query results to avoid recomputation. Batch embedding
already reduces API calls but doesn't persist results across sessions.

## 11. 🧵 Parallel Processing

Batch embedding is implemented (`embedBatch` with configurable batch size).
Further work: multi-threaded file scanning for large repos, parallel chunking
during indexing.

## 12. 🧩 Embedding Provider Extensibility

Already implemented via `EmbeddingProvider` interface and `createEmbedder()`
factory. Adding a new provider means writing one class and adding a switch
case. See `AGENTS.md` for the step-by-step guide.

## 13. 🧠 Multi-Modal Support

Extend chunking beyond text: diagrams, JSON schemas, API specs, YAML configs.

## 14. 🧾 Prompt Templates

Allow users to customize how retrieved context is formatted and injected into
LLM prompts. Currently the plugin uses a fixed formatting pattern.

## 15. 🕵️ Debugging Tools

Inspect embeddings visually, show vector distances between results, explain
why a particular chunk was retrieved for a query.

## 16. 📉 Memory & Storage Optimization

Quantized embeddings to reduce storage, pruning stale entries, garbage
collection on unused chunks.

---

# 🎯 Summary

**OpenCodeRAG** delivers a local-first semantic code search pipeline with AST
chunking, incremental indexing, configurable embeddings, LanceDB vector
storage, a CLI, and OpenCode plugin integration.

Key strengths:

- Local + privacy-first
- Modular architecture (interfaces + factory/adapter patterns)
- Workspace-native
- No native build tools required (WASM-based parsing)

Key next steps:

1. Hybrid search + re-ranking — retrieval quality
2. Code graph integration — structural code understanding
3. Context window optimization — better result packing for prompts
