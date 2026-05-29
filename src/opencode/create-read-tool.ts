import { tool } from "@opencode-ai/plugin/tool";
import type { EmbeddingProvider, VectorStore, SearchResult } from "../core/interfaces.js";
import type { RagConfig } from "../core/config.js";
import { retrieve } from "../retriever/retriever.js";
import { normalizeReadArgs, resolveWorkspacePath } from "./tool-args.js";
import { buildReadQuery } from "./read-query.js";
import { formatReadOutput } from "./read-format.js";
import {
  missingIndexMessage,
  getNoResultsMessage,
  retrievalErrorMessage,
} from "./read-fallback.js";

export interface RagReadToolOptions {
  /** Workspace root directory. */
  worktree: string;
  /** Full RAG configuration. */
  config: RagConfig;
  /** Embedding provider for retrieval. */
  embedder: EmbeddingProvider;
  /** Vector store for retrieval. */
  store: VectorStore;
  /** Optional log file path for debug logging. */
  logFilePath?: string;
}

/**
 * Create the RAG-backed read tool for OpenCode plugin registration.
 *
 * The tool accepts read-like arguments (filePath/path/absolutePath,
 * offset/limit, startLine/endLine, query/reason) and returns
 * relevant indexed chunks instead of full file contents.
 */
export function createRagReadTool(
  options: RagReadToolOptions
): ReturnType<typeof tool> {
  const { worktree, config, embedder, store } = options;
  const openCodeCfg = config.openCode;
  const maxContextChunks = openCodeCfg.maxContextChunks;
  const maxReadOutputChars = openCodeCfg.maxReadOutputChars ?? 20000;
  const noResultsBehavior = openCodeCfg.readNoResultsBehavior ?? "hint";
  const retrievalTopK = maxContextChunks * 4;

  return tool({
    description:
      "Read file contents from the workspace. Returns relevant indexed code chunks " +
      "instead of full file contents for token-efficient code understanding. " +
      "Provide a file path and optionally a query/reason, line range, or both.",

    args: {
      filePath: tool.schema.string().optional(),
      path: tool.schema.string().optional(),
      absolutePath: tool.schema.string().optional(),
      offset: tool.schema.number().int().optional(),
      limit: tool.schema.number().int().optional(),
      startLine: tool.schema.number().int().optional(),
      endLine: tool.schema.number().int().optional(),
      query: tool.schema.string().optional(),
      reason: tool.schema.string().optional(),
    },

    async execute(args: Record<string, unknown>) {
      try {
        // 1. Normalize and validate arguments
        const normalized = normalizeReadArgs(args as never);

        // 2. Resolve workspace path
        const resolvedPath = resolveWorkspacePath(worktree, normalized.filePath);

        // 3. Build retrieval query
        const retrievalQuery = buildReadQuery({
          query: normalized.query,
          filePath: resolvedPath,
          startLine: normalized.startLine,
          endLine: normalized.endLine,
        });

        // 4. Check if index exists
        const count = await store.count();
        if (count === 0) {
          return {
            title: "Read (OpenCodeRAG)",
            output: missingIndexMessage(),
            metadata: {
              tool: "read",
              filePath: resolvedPath,
              indexed: false,
            },
          };
        }

        // 5. Run retrieval with higher topK for filtering
        const rawResults = await retrieve(retrievalQuery, embedder, store, {
          topK: retrievalTopK,
        });

        if (rawResults.length === 0) {
          const output = getNoResultsMessage(noResultsBehavior, resolvedPath);
          return {
            title: "Read (OpenCodeRAG)",
            output,
            metadata: {
              tool: "read",
              filePath: resolvedPath,
              chunks: 0,
              indexed: true,
            },
          };
        }

        // 6. Filter results to the requested file
        let filtered = rawResults.filter(
          (r) => r.chunk.metadata.filePath === resolvedPath
        );

        // 7. If file has no results, use no-results behavior
        if (filtered.length === 0) {
          const output = getNoResultsMessage(noResultsBehavior, resolvedPath);
          return {
            title: "Read (OpenCodeRAG)",
            output,
            metadata: {
              tool: "read",
              filePath: resolvedPath,
              chunks: 0,
              indexed: true,
            },
          };
        }

        // 8. Apply line-range overlap filtering
        const lineFiltered = applyLineRangeFilter(
          filtered,
          normalized.startLine,
          normalized.endLine
        );

        // Re-sort by score descending
        lineFiltered.sort((a, b) => b.score - a.score);

        // 9. Format output
        const output = formatReadOutput({
          filePath: resolvedPath,
          retrievalQuery,
          results: lineFiltered,
          maxChunks: maxContextChunks,
          maxChars: maxReadOutputChars,
        });

        // 10. Return
        return {
          title: `Read (OpenCodeRAG) — ${resolvedPath}`,
          output,
          metadata: {
            tool: "read",
            filePath: resolvedPath,
            chunks: Math.min(lineFiltered.length, maxContextChunks),
            totalResults: lineFiltered.length,
            indexed: true,
          },
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          title: "Read (OpenCodeRAG)",
          output: retrievalErrorMessage(message),
          metadata: {
            tool: "read",
            filePath: undefined,
            error: message,
          },
        };
      }
    },
  });
}

/**
 * Filter search results by line-range overlap.
 *
 * A chunk overlaps the requested range when:
 *   chunk.startLine <= requestedEndLine && chunk.endLine >= requestedStartLine
 *
 * If only startLine is provided: chunk.endLine >= requestedStartLine
 * If only endLine is provided: chunk.startLine <= requestedEndLine
 */
function applyLineRangeFilter(
  results: SearchResult[],
  startLine?: number,
  endLine?: number
): SearchResult[] {
  if (startLine === undefined && endLine === undefined) {
    return results;
  }

  return results.filter((r) => {
    const cs = r.chunk.metadata.startLine;
    const ce = r.chunk.metadata.endLine;

    if (startLine !== undefined && endLine !== undefined) {
      return cs <= endLine && ce >= startLine;
    }
    if (startLine !== undefined) {
      return ce >= startLine;
    }
    if (endLine !== undefined) {
      return cs <= endLine;
    }
    return true;
  });
}
