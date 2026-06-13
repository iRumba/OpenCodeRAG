# OpenCodeRAG

OpenCodeRAG is a **local-first RAG plugin** for semantic code search. It ingests your codebase into a vector index and retrieves relevant code chunks on natural language queries — saving tokens by replacing full-file reads with targeted chunk retrieval. Integrates seamlessly with [OpenCode](https://opencode.ai) and works standalone via CLI.

[![npm version](https://img.shields.io/npm/v/opencode-rag-plugin.svg)](https://www.npmjs.com/package/opencode-rag-plugin)

> ⚠️ **Note:** Don't confuse this with `opencode-rag` (a discontinued package by a different author). Use **`opencode-rag-plugin`**.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/OpenCodeRAG.git
cd OpenCodeRAG
npm install --legacy-peer-deps
npm run build
./install.sh                          # global install (optional)

# 2. Initialize in your project
cd /path/to/your/project
opencode-rag init

# 3. Index your workspace
opencode-rag index

# 4. Search
opencode-rag query "authentication middleware"
```

**Prerequisites:** Node.js v22+, [Ollama](https://ollama.ai) (default) or OpenAI-compatible API.

## Key Features

| Feature | Description |
|---|---|
| **AST chunking** | 17 languages via tree-sitter (TS, JS, Python, Java, Go, Rust, C/C++, C#, Ruby, Kotlin, Swift, JSON, HTML, CSS, XML) |
| **Document support** | Markdown, LaTeX, PDF, DOCX, DOC, Excel |
| **Hybrid search** | Vector similarity + TF×IDF keyword fusion |
| **OpenCode plugin** | Auto-inject context, read-tool override, TUI settings |
| **Incremental indexing** | File-hash manifest, background watcher, auto-rebuild on corruption |
| **Privacy-first** | All processing stays local with Ollama |
| **CLI** | `index`, `query`, `status`, `list`, `show`, `dump`, `clear`, `init` |
| **Proxy-aware** | Corporate proxy support with raw-socket localhost bypass |
| **OpenAI / Cohere** | Alternate embedding providers with API key auto-resolution |

## Documentation

| Document | Contents |
|---|---|
| [Architecture](doc/architecture.md) | Module design, data flow, tech stack |
| [Installation](doc/installation.md) | Full install guide, global setup, uninstall |
| [Configuration](doc/configuration.md) | All options: embedding, indexing, retrieval, description, plugin |
| [Chunking](doc/chunking.md) | Language matrix, adding new chunkers, custom chunkers |
| [Embedding](doc/embedding.md) | Providers, model recommendations, proxy, dimension probing |
| [Retrieval](doc/retrieval.md) | Pipeline, hybrid search, score fusion, caching |
| [Plugin](doc/plugin.md) | OpenCode integration, tools, hooks, TUI, troubleshooting |
| [CLI Reference](doc/cli.md) | All commands, options, examples |
| [Development](doc/development.md) | Setup, testing, conventions, adding providers |
| [Troubleshooting](doc/troubleshooting.md) | Common issues, logging, debugging |
| [Roadmap](doc/roadmap.md) | Completed items, short/mid/long-term plans |

## AGENTS.md Setup

Add this to your workspace's `AGENTS.md` so OpenCode agents know how to use the plugin:

```markdown
## OpenCodeRAG Plugin

This workspace has OpenCodeRAG installed for semantic code retrieval.

### `opencode-rag-context` tool
Before planning, editing, or answering, use this tool to retrieve relevant code
chunks with file paths, line ranges, and surrounding implementation.
- `query` (required) — narrow, specific search
- `pathHints` (optional) — up to 10 path filters
- `languageHints` (optional) — up to 10 language filters
- `topK` (optional) — result count (1–25, default 10)
```

## Privacy & Security

**100% local by default.** Embeddings are generated locally via Ollama. The vector database stays in your project directory. **No source code or embeddings leave your machine** unless you explicitly configure a third-party API.

## License

MIT
