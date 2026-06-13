# Installation

## Prerequisites

- **Node.js v22+** (required for native ESM and global `fetch`)
- **Ollama** (default) running locally, OR an OpenAI-compatible API endpoint
- **OpenCode** (optional) for agent plugin features

## Quick Install

```bash
# Clone the repository
git clone https://github.com/your-org/OpenCodeRAG.git
cd OpenCodeRAG

# Install dependencies
npm install --legacy-peer-deps

# Build
npm run build

# (Optional) Install globally
./install.sh          # Linux/macOS
.\install.ps1         # Windows
```

## Global Installation via Script

The `install.sh` / `install.ps1` scripts handle:

1. `npm run build` + `npm pack` to produce a `.tgz`
2. `npm install --prefix ~/.opencode/` and `--prefix ~/.config/opencode/`
3. Adding `"opencode-rag-plugin"` to `~/.config/opencode/opencode.jsonc` plugin array
4. Creating a CLI symlink for `opencode-rag`
5. Cleaning up stale global plugin registrations

> **Important:** The install scripts build from source (npm pack). They never call `opencode plugin <name> --global`, which would download the potentially stale npm-published version.

### Uninstall

```bash
./install.sh uninstall
.\install.ps1 uninstall
```

This removes all copies from `~/.local/bin/`, `~/.config/opencode/node_modules/`, `~/.opencode/node_modules/`, and cleans up `.tgz` files and config entries.

## Workspace Initialization

After installation, initialize any project you want to use with OpenCodeRAG:

```bash
cd /path/to/your/project
opencode-rag init
```

This creates:
- `.opencode/plugins/rag-plugin.js` — workspace-local plugin fallback (re-exports from `node_modules/`)
- `.opencode/plugins/rag-tui.js` — TUI plugin module
- `.opencode/opencode.json` — OpenCode workspace config
- `.opencode/tui.json` — TUI plugin settings
- `.opencode/package.json` — workspace dependencies
- `opencode-rag.json` — Runtime configuration
- `.opencode/.gitignore` — ignores `node_modules/` and `rag_db/`
- Runs `npm install` to install workspace dependencies

Use `--skip-install` to skip the npm install step. Use `--force` to overwrite existing files.

## Running Without Global Installation

```bash
npx opencode-rag init
npx opencode-rag index
npx opencode-rag query "your search query"
```

## npm Package

The package is published as `opencode-rag-plugin` on npm:

```bash
npm install --save-dev opencode-rag-plugin
```

> ⚠️ **Note:** Do not confuse with the npm package `opencode-rag`, which is a discontinued project by a different author.

## Verifying Your Installation

```bash
opencode-rag status
```

This shows the index statistics, store path, provider, model, manifest status, and keyword index status.
