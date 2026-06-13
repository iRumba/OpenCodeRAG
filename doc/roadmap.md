# Roadmap

See [PLANNING.md](../PLANNING.md) for the full detailed roadmap and brainstorming document.

## ✅ Completed / Shipped

### Chunking & Indexing

- AST-based code chunking for 17 languages
- Regex/document chunking for Markdown, Razor, .sln, LaTeX
- Document text extraction for PDF, DOCX, DOC, Excel
- Line-based fallback chunking
- Pluggable chunkers via config
- Incremental indexing (file-hash-based, manifest-backed)
- File watching and background re-indexing
- Enhanced chunk descriptions with relative paths and line numbers

### Embedding & Storage

- Embedding providers: Ollama, OpenAI, Cohere
- Proxy-aware embedding transport with raw socket localhost bypass
- Dimension probing at startup
- LanceDB vector storage with `memory://` test mode
- Batch embedding
- Auto-detection of LanceDB schema for seamless upgrades

### Retrieval

- Vector search pipeline
- Hybrid search (TF×IDF keyword + vector fusion)
- Session-level retrieval cache
- Auto-context injection on `chat.message`
- Configurable auto-inject settings

### OpenCode Plugin

- `opencode-rag-context` tool
- `chat.message` hook with file suggestions and auto-injection
- RAG-backed read override tool
- TUI settings panel with model picker dropdowns
- OpenCode v1.17.0 compatible PluginModule export
- Background auto-indexing with watcher status
- API key auto-resolution from OpenCode provider config

### CLI & Distribution

- Full CLI: `init`, `index`, `query`, `clear`, `status`, `list`, `show`, `dump`
- `init` command lifecycle with plugin generation, gitignore, npm install
- Install scripts (`.sh` / `.ps1`) with uninstall support
- Release automation script
- Published npm package: `opencode-rag-plugin`

### Configuration & Quality

- JSON config with deep-merged partial overrides
- Runtime overrides system for live TUI changes
- Configurable file logging
- Manifest schema versioning with corruption detection
- 589+ automated tests

## Short Term

| Feature | Description |
|---|---|
| LLM-based re-ranking | Cross-encoder or lightweight model after vector search |
| Query rewriting | Multi-variant expansion for ambiguous queries |
| Context window optimization | Dedup, merge adjacent chunks, diversity ranking |
| Better file suggestions | Improved ranking/diversity for `chat.message` file lists |
| Debug/retrieval surfaces | Explain why files or chunks were returned |

## Mid Term

| Feature | Description |
|---|---|
| Cross-file relationship graph | Import/call graph for dependency-aware search |
| Multi-repo search | Index and search across multiple workspaces |
| IDE context awareness | Use current file, cursor position for relevance boosting |
| Prompt customization | Customize how retrieved context is formatted |
| Debugging tools | Inspect embeddings, vector distances, result explanations |
| Persistent session memory | Retain coding patterns and decisions across sessions |

## Long Term

| Feature | Description |
|---|---|
| Evaluation framework | Benchmark queries, precision@K, recall measurements |
| Code execution-aware retrieval | Run code to understand its behavior for better retrieval |
| Semantic refactoring assistant | Code transformations based on natural language |
| Agent-based code navigation | Autonomous exploration of codebase structure |
| Multimodal support | Diagrams, API specs, JSON schemas, YAML configs |
| Access control | Per-folder permissions, sensitive file exclusion |
| Web UI | Browser-based index inspection and search result browsing |

## Key Next Steps

1. **LLM-based re-ranking** for retrieval precision
2. **Code graph integration** for structural code understanding
3. **Context window optimization** for better prompt packing
4. **Query rewriting** and retrieval explainability
5. **Persistent session memory** across coding sessions
6. **Web UI** for index inspection and search result browsing
