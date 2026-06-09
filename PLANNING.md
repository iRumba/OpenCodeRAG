# 🛣️ Roadmap

## ✅ Completed / Shipped

- [x] AST-based code chunking for 16 languages: TypeScript, Python, Java, Go, C, C++, C#, JavaScript, Rust, Ruby, Kotlin, Swift, JSON, HTML, CSS, XML
- [x] Regex/document chunking for Markdown, Razor, .sln, and LaTeX plus document text extraction for PDF, DOCX, DOC, and Excel
- [x] Line-based fallback chunking for unsupported formats
- [x] Embedding providers (Ollama + OpenAI, factory-pattern dispatch)
- [x] Proxy-aware embedding transport with config/env support, auth headers, and localhost direct-request bypass
- [x] Vector storage (LanceDB with `memory://` test mode)
- [x] Retrieval pipeline (embed → search → score → return)
- [x] CLI (`init`, `index`, `query`, `clear`, `status` via commander)
- [x] Workspace bootstrap via `opencode-rag init` for project-local OpenCode plugin setup
- [x] OpenCode plugin with `opencode-rag-context`, `experimental.chat.system.transform`, `chat.message` file suggestions, and background auto-indexing
- [x] Incremental indexing (file-hash-based, manifest-backed, diff-aware)
- [x] File watching and background re-indexing with debounced, serialized passes
- [x] Pluggable storage via `VectorStore` interface
- [x] Pluggable chunkers via `Chunker` interface and config-loaded custom chunkers
- [x] Pluggable embedders via `EmbeddingProvider` interface
- [x] JSON config with deep-merged partial overrides
- [x] Batch embedding (configurable batch size)
- [x] Configurable file logging
- [x] Published npm package: `opencode-rag-plugin`
- [x] Expanded automated test suite (511 tests, Node built-in runner)
- [x] Auto-context injection on `chat.message` — high-confidence chunks are injected directly into messages, saving tool-call round-trips
- [x] Hybrid search (TF×IDF keyword + vector fusion) — weighted `(1-kw)*vScore + kw*kScore` merging with CamelCase/snake_case tokenizer

## Short Term

- [ ] Query rewriting / multi-variant expansion
- [ ] Context window optimization (dedup, merge adjacent chunks)
- [ ] Better ranking/diversity for `chat.message` file suggestions
- [ ] Clearer retrieval/debug surfaces for why files or chunks were returned

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
- [ ] Richer non-code / multimodal support (diagrams, API specs, JSON schemas, YAML configs)
- [ ] Access control (per-folder permissions, sensitive file exclusion)

---

# 💡 Brainstorming: Future Enhancements

## 1. 🔁 Incremental Indexing + Watch Mode

Implemented with a manifest sidecar beside the LanceDB dataset. Indexing now
hashes files, skips unchanged files, updates modified files, removes deleted,
empty, or too-small files, and safely rebuilds if the manifest is missing or
corrupt while the store already contains rows.

Watch mode (`index --watch`) uses chokidar to trigger debounced incremental
passes on add/change/unlink events. Passes are serialized, and the plugin uses
the same scheduling model for background auto-indexing inside OpenCode.

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

## 5. 🧱 Hybrid Search (Keyword + Vector)

Implemented as TF×IDF inverted index with zero dependencies. `retrieval.hybridSearch.keywordWeight` controls the fusion balance (default 0.4). Tokenizer handles CamelCase, snake_case, and code-specific patterns.

## 6. 🧾 Context Window Optimization

Prevent token overload by deduplicating similar chunks, merging adjacent
chunks, and ranking by diversity. Currently `maxContextChunks` limits the
count, but no quality filtering is applied.

## 7. 🧑‍💻 IDE/Editor Context Awareness

Integrate with the editor's current context: active file, cursor position, and
selected code. Boost retrieval relevance by weighting results near the user's
current focus.

## 8. 🧪 Evaluation Framework

Measure retrieval quality with benchmark queries, precision@K, and recall.
Needed before tuning chunking strategies or embedding models.

## 9. 🔐 Access Control

Per-folder permissions and sensitive file exclusion for enterprise or
multi-user environments.

## 10. 🧠 Caching Layer

Cache embeddings and query results to avoid recomputation. Batch embedding
already reduces API calls but does not persist results across sessions.

## 11. 🧵 Parallel Processing

Batch embedding is implemented (`embedBatch` with configurable batch size).
Further work: multi-threaded file scanning for large repos and parallel
chunking during indexing.

## 12. 🧩 Embedding Provider Extensibility

Already implemented via `EmbeddingProvider` interface and `createEmbedder()`
factory. Adding a new provider means writing one class and adding a switch
case. See `AGENTS.md` for the step-by-step guide.

## 13. 🧠 Non-Code / Multimodal Retrieval

Initial document support is already in place via extracted text for PDF, DOC,
DOCX, and Excel files. Future work extends beyond text extraction to richer
artifacts such as diagrams, JSON schemas, API specs, and YAML configs.

## 14. 🧾 Prompt Templates

Allow users to customize how retrieved context is formatted and injected into
LLM prompts. The plugin currently uses a fixed formatting pattern.

## 15. 🕵️ Debugging Tools

Inspect embeddings visually, show vector distances between results, explain
why a particular chunk or file was retrieved for a query.

## 16. 📉 Memory & Storage Optimization

Quantized embeddings to reduce storage, pruning stale entries, and garbage
collection on unused chunks.

---

# 🎯 Summary

**OpenCodeRAG** now delivers a local-first semantic code search pipeline with
AST and document-aware chunking, incremental/background indexing, configurable
embeddings with proxy support, LanceDB vector storage, a bootstrap-aware CLI,
and OpenCode plugin integration.

Key strengths:

- Local + privacy-first
- Modular architecture (interfaces + factory/adapter patterns)
- Workspace-native bootstrap via `opencode-rag init`
- Broad source and document coverage without native grammar build tools

Key next steps:

1. Hybrid search + re-ranking for retrieval quality
2. Code graph integration for structural code understanding
3. Context window optimization for better prompt packing
4. Query rewriting and retrieval explainability
