# OpenCode Plugin Integration

OpenCodeRAG integrates with OpenCode as a plugin, providing semantic code search directly within agent conversations.

## How the Plugin Works

The plugin (`src/plugin.ts`) registers three integration points with OpenCode:

### 1. `opencode-rag-context` Tool

A tool that any OpenCode agent can invoke to search the indexed codebase:

**Parameters:**

| Param | Required | Description |
|---|---|---|
| `query` | Yes | Narrow, specific search query |
| `pathHints` | No | Up to 10 path filters (e.g., `["src/auth/"]`) |
| `languageHints` | No | Up to 10 language filters (e.g., `["typescript"]`) |
| `topK` | No | Result count (1–25, default 10) |

**Returns:** Formatted markdown with file paths, line ranges, score, language, content preview, and descriptions for each relevant chunk.

### 2. `chat.message` Hook — Auto-Injection

After each user message, the plugin runs automatic retrieval:

- **High-confidence results** (score ≥ `openCode.autoInject.minScore`, default 0.75): Actual code chunks are injected directly into the message under an **Auto-retrieved code context** header. This saves a tool-call round-trip.
- **Lower-confidence results**: A compact file suggestion list is appended as `path (lang, lines N-M)` — up to 10 files, no scores or snippets.

The auto-injection respects:
- `maxChunks` (default 3) — maximum chunks to inject
- `maxTokens` (default 2000) — token budget (~4 chars/token estimate)
- Low-scoring chunks are evicted first to fit the budget
- Paths are made relative via `path.relative(worktree, ...)`

### 3. Read Tool Override

When `openCode.readOverride` is `true`:

- The plugin registers a `read` tool that shadows OpenCode's built-in read
- **Always returns full file contents** from disk
- When RAG chunks are available for the file (score ≥ threshold), they are appended as "Related code chunks" after the file content
- If retrieval fails, the file is still returned without RAG context
- If no relevant chunks are found but the file has indexed chunks, related files are suggested

## Plugin Architecture

```
                    OpenCode Runtime
                           │
            ┌──────────────┴──────────────┐
            │                             │
    ragPlugin()                    BackgroundIndexer
            │                             │
    createRagHooks()                chokidar watcher
            │                             │
    ┌───────┼───────────┐         debounced scheduler
    │       │           │                 │
  Tool   chat.message  read          periodic timer
  hook    hook        override
```

## Plugin Export Pattern

For OpenCode v1.17.0 compatibility, the plugin uses the `PluginModule` export pattern:

```typescript
import { ragPlugin } from "./plugin.js";

export const server = ragPlugin;
export const id = "opencode-rag-plugin";
export default { id: "opencode-rag-plugin", server: ragPlugin };
```

Key requirements:
- The `default` export MUST be an **object** `{ id, server }`, not a bare function
- Named exports are kept for backward compatibility but not used by the V1 loader
- The TUI plugin (`rag-tui.js`) must also default-export an object with `server()`:

```javascript
const plugin = {
  id: "opencode-rag-plugin:tui",
  server: async () => ({}),
};
export default plugin;
```

## Plugin Registration

Do NOT register the plugin via `"plugin": ["opencode-rag-plugin"]` in OpenCode config. Instead, rely on `.opencode/plugins/*.js` auto-discovery:

1. Run `opencode-rag init` to create `.opencode/plugins/rag-plugin.js`
2. The generated file re-exports from `node_modules/`:

```javascript
import plugin from "../node_modules/opencode-rag-plugin/dist/plugin-entry.js";
export const id = plugin.id;
export const server = plugin.server;
export default plugin;
```

## Background Auto-Indexing

The plugin spawns one `BackgroundIndexer` per workspace directory (via `src/watcher.ts`):

- **chokidar watcher**: Monitors file changes in the workspace
- **Debounced scheduler**: Waits `autoIndex.debounceMs` (default 2000ms) after changes before re-indexing
- **Periodic timer**: Runs a full pass every `autoIndex.intervalMs` (default 5 min)
- **Error recovery**: Detects LanceDB corruption and triggers auto-rebuild
- **Status file**: Writes `watcher-status.json` to the store path for observability

## TUI Settings Menu

The TUI plugin (`src/tui.ts`) registers a settings panel in the OpenCode sidebar:

### Categories

| Category | Settings |
|---|---|
| Retrieval | `topK`, `minScore`, `maxChunks`, hybrid search toggle |
| Embedding | Model picker dropdown (populated from OpenCode's registered providers) |
| LLM Descriptions | Enable/disable toggle, model picker dropdown |

### Features

- **Model picker**: Groups models by provider name, sorted alphabetically, with "Custom…" option for manual entry
- **Auto-sets provider and base URL** when a model is selected
- **Runtime overrides**: Settings are persisted to `${storePath}/runtime-overrides.json` and take precedence over `opencode-rag.json`
- **Status sidebar**: Shows chunk count, provider/model info, last indexed time, watcher state
- **Keyboard shortcut**: `Ctrl+Shift+R` opens the settings dialog
- **Auto-refresh**: Status refreshes every 30 seconds

## Plugin Troubleshooting

### "Plugin export is not a function" Error

This occurs when OpenCode's Bun runtime tries to load the plugin via the `"plugin"` key in OpenCode config, causing module resolution issues.

**Fix:**
1. Ensure the plugin is loaded via `.opencode/plugins/*.js` auto-discovery, NOT via `"plugin"` config key
2. Run `opencode-rag init` to regenerate the workspace-local plugin files
3. Remove stale `"plugin"` entries from all OpenCode config files

### Debugging Plugin Loading

```bash
node --input-type=module -e \
  "const m = await import('opencode-rag-plugin'); console.log(typeof m.default, typeof m.server)"
```

## API Key Auto-Resolution

When using OpenAI as the embedding or description provider, the plugin auto-resolves the API key from OpenCode's own provider configuration if not specified in `opencode-rag.json`:

- Searches `.opencode/opencode.json`, `opencode.json`, `~/.config/opencode/opencode.jsonc`
- Strips JSONC comments before parsing
- Finds the `apiKey` for the `openai` provider
