# Web UI

The OpenCodeRAG Web UI is a lightweight browser-based dashboard for exploring the indexed vector database. It is built with Tailwind CSS and highlight.js, served from a zero-dependency Node.js HTTP server.

![Web UI](assets/webui.png)

## Starting the Web UI

```bash
opencode-rag ui
```

Opens `http://127.0.0.1:3210` in your browser automatically.

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-p, --port <number>` | `3210` | Port to listen on |
| `--no-open` | — | Skip automatic browser launch |
| `-c, --config <path>` | auto-detected | Path to config file |

The server binds to `127.0.0.1` only (localhost). Press `Ctrl+C` to stop.

## Configuration

```json
{
  "ui": {
    "port": 3210,
    "openBrowser": true
  }
}
```

| Option | Default | Description |
|---|---|---|
| `port` | `3210` | HTTP server port |
| `openBrowser` | `true` | Open browser on start |

## Views

### Dashboard

The default view. Shows four KPI cards:

- **Total Chunks** — number of indexed chunks
- **Total Files** — number of indexed files
- **Languages** — number of distinct languages
- **Avg Chunks/File** — mean chunks per file

Below the cards, a **Language Distribution** bar chart displays the top 8 languages by chunk count, with percentage labels.

### Chunks

A master-detail split pane for browsing individual chunks.

**Left pane (master):** Paginated table with columns:

| Column | Description |
|---|---|
| checkbox | Select for comparison |
| File | File path + line range (e.g. `src/plugin.ts:10-42`) |
| Lang | Language badge (color-coded) |
| Description | Truncated chunk description |

Click a row to view its details. Use **Previous** / **Next** to paginate.

**Right pane (detail):** Shows the selected chunk:

- File path, line range, language badge, chunk ID
- **Description** card (LLM-generated or path-based)
- **Source Code** panel with syntax highlighting and a **Copy** button

Active filters (language, file) appear as dismissible badges above the table.

### Files

A table of all indexed files with:

| Column | Description |
|---|---|
| File | Full file path |
| Lang | Language badge |
| Chunks | Number of chunks for that file |

Click a file row to navigate to the Chunks view filtered by that file.

### Compare

Side-by-side comparison of 2–3 chunks. Select chunks via checkboxes in the Chunks view, then switch to Compare to see them rendered in parallel with syntax highlighting.

### Evaluate

Session analytics dashboard for tracking token usage, costs, and RAG performance across OpenCode conversations.

![Evaluate View](assets/eval.png)

**Session List:** A table of all recorded sessions with columns:

| Column | Description |
|---|---|
| checkbox | Select for comparison |
| Session | Session title or ID |
| Last Activity | Timestamp of last event |
| Messages | Total message count |
| Input Tokens | Input + cache read tokens |
| Output Tokens | Output tokens generated |
| Cost | Estimated API cost |
| RAG Calls | Number of RAG context injections |
| RAG Tokens | Tokens used for RAG context |
| Model | Primary model used |

**Actions:**
- Click a row to view session details
- Select 2 sessions via checkboxes and click **Compare Selected** for side-by-side comparison
- Click the trash icon to delete a session

**Session Detail:** Expanded view showing:

- **KPI Cards:** Total Tokens, Input Tokens, Output Tokens, Cost, RAG Context Tokens
- **Metrics:** Messages, Steps, RAG Injections, Avg Response time
- **Tool Calls:** Breakdown of tool usage (bash, read, edit, webfetch, grep, glob, task, search_semantic, question)
- **Models Used:** List of models active in the session
- **Event Timeline:** Chronological log of session events with timestamps

## File Tree Sidebar

A collapsible directory tree in the left sidebar:

- Directories show a file count badge and expand/collapse on click
- Files are color-coded by language
- Active file is highlighted
- **Filter input** at the top narrows the tree by path substring
- Clicking a file navigates to the Chunks view filtered to that file

## Global Search

A search input in the top-right header:

- Debounced keyword search against the TF×IDF index
- Results appear in a dropdown panel showing file path, line range, language, and description
- Click a result to navigate directly to that chunk in the Chunks view

## API Endpoints

The web server exposes a REST API under `/api/`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/stats` | GET | Total chunks, total files, language distribution |
| `/api/files` | GET | All indexed files with metadata |
| `/api/chunks?offset=&limit=&lang=&file=` | GET | Paginated, filtered chunks |
| `/api/chunks/:id` | GET | Single chunk by ID |
| `/api/search?q=&topK=` | GET | Keyword search via KeywordIndex |
| `/api/compare?ids=` | GET | Fetch multiple chunks for side-by-side view |
| `/api/eval/sessions` | GET | All recorded sessions with summary stats |
| `/api/eval/sessions/:id` | GET | Single session detail with events |
| `/api/eval/sessions/:id` | DELETE | Delete a recorded session |

All endpoints return JSON with `Access-Control-Allow-Origin: *`.
