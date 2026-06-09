import { tool } from "@opencode-ai/plugin/tool";
import type { EmbeddingProvider, KeywordIndex, VectorStore, SearchResult } from "../core/interfaces.js";
import type { RagConfig } from "../core/config.js";
import { retrieve } from "../retriever/retriever.js";
import { normalizeReadArgs, resolveWorkspacePath } from "./tool-args.js";
import { buildReadQuery } from "./read-query.js";
import { formatReadOutput, formatRelatedFiles } from "./read-format.js";
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
  /** Session-level store for last user message text (keyed by sessionID). */
  sessionLastMessage?: Map<string, string>;
  /** Session-level retrieval cache (keyed by sessionID). */
  sessionRetrievalCache?: Map<string, { messageText: string; rawResults: SearchResult[] }>;
  /** Optional keyword index for hybrid search. */
  keywordIndex?: KeywordIndex;
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
  const { worktree, config, embedder, store, sessionLastMessage, sessionRetrievalCache, keywordIndex } = options;
  const openCodeCfg = config.openCode;
  const maxContextChunks = openCodeCfg.maxContextChunks;
  const maxReadOutputChars = openCodeCfg.maxReadOutputChars ?? 20000;
  const noResultsBehavior = openCodeCfg.readNoResultsBehavior ?? "hint";
  const retrievalTopK = maxContextChunks * 4;
  const readRelatedFilesMax = openCodeCfg.readRelatedFilesMax ?? 5;

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

    async execute(args: Record<string, unknown>, ctx?: { sessionID?: string }) {
      try {
        // 1. Normalize and validate arguments
        const normalized = normalizeReadArgs(args as never);

        // 2. Resolve workspace path
        const resolvedPath = resolveWorkspacePath(worktree, normalized.filePath);

        // 3. Build retrieval query (chat-context-aware if available)
        const sessionID = ctx?.sessionID;
        const messageText = sessionID ? sessionLastMessage?.get(sessionID) ?? "" : "";

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

        // 5. Get or create cached raw results for this session
        let rawResults: SearchResult[];
        let retrievalQuery: string;

        if (sessionID && sessionRetrievalCache) {
          const cached = sessionRetrievalCache.get(sessionID);

          if (cached && cached.messageText === messageText) {
            // Cache hit — reuse raw results
            rawResults = cached.rawResults;
            retrievalQuery = messageText.length > 0
              ? messageText
              : (buildReadQuery({ filePath: resolvedPath }).split("\n")[0] ?? "");
          } else {
            // Cache miss or new message — run retrieval
            retrievalQuery = buildSessionQuery(messageText, resolvedPath, normalized);
            rawResults = await retrieve(retrievalQuery, embedder, store, { topK: retrievalTopK, keywordIndex });
            sessionRetrievalCache.set(sessionID, { messageText, rawResults: rawResults });
          }
        } else {
          // No session/context — direct retrieval
          retrievalQuery = buildReadQuery({
            query: normalized.query,
            filePath: resolvedPath,
            startLine: normalized.startLine,
            endLine: normalized.endLine,
          });
          rawResults = await retrieve(retrievalQuery, embedder, store, { topK: retrievalTopK, keywordIndex });
        }

        // 6. Collect related files from raw results (before filtering)
        const relatedFiles = collectRelatedFiles(rawResults, resolvedPath, readRelatedFilesMax);

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

        // 7. Filter results to the requested file
        let filtered = rawResults.filter(
          (r) => r.chunk.metadata.filePath === resolvedPath
        );

        // 8. If file has no results, use no-results behavior
        if (filtered.length === 0) {
          let output = getNoResultsMessage(noResultsBehavior, resolvedPath);
          if (readRelatedFilesMax > 0 && relatedFiles.length > 0) {
            output += "\n\n" + formatRelatedFiles(relatedFiles);
          }
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

        // 9. Apply line-range overlap filtering
        const lineFiltered = applyLineRangeFilter(
          filtered,
          normalized.startLine,
          normalized.endLine
        );

        // Re-sort by score descending
        lineFiltered.sort((a, b) => b.score - a.score);

        // 10. Format output
        let output = formatReadOutput({
          filePath: resolvedPath,
          retrievalQuery,
          results: lineFiltered,
          maxChunks: maxContextChunks,
          maxChars: maxReadOutputChars,
        });

        // 11. Append related files if enabled
        if (readRelatedFilesMax > 0 && relatedFiles.length > 0) {
          output += "\n\n" + formatRelatedFiles(relatedFiles);
        }

        // 12. Return
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

/** Arguments for building a session-level retrieval query. */
interface SessionQueryArgs {
  query?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Build a retrieval query from the session's user message plus file path hints.
 *
 * When message text is available, it becomes the primary semantic query with
 * the file path as a targeted hint. When no message text exists, falls back
 * to the standard file-path-based query.
 */
function buildSessionQuery(
  messageText: string,
  resolvedPath: string,
  normalized: SessionQueryArgs
): string {
  // Use message text as the semantic query if available
  if (messageText.length > 0) {
    // Include file path info so the embedding narrows to that file
    const parts = [
      messageText,
      `Looking for relevant code in file: ${resolvedPath}`,
    ];
    if (normalized.startLine !== undefined && normalized.endLine !== undefined) {
      parts.push(`Focus on lines ${normalized.startLine}-${normalized.endLine}.`);
    } else if (normalized.startLine !== undefined) {
      parts.push(`Focus on lines near ${normalized.startLine}.`);
    }
    return parts.join("\n");
  }

  // Fall back to standard query
  return buildReadQuery({
    query: normalized.query,
    filePath: resolvedPath,
    startLine: normalized.startLine,
    endLine: normalized.endLine,
  });
}

/** A collected related file entry. */
interface RelatedFileEntry {
  filePath: string;
  score: number;
}

/**
 * Collect unique related files from raw search results, excluding the
 * requested file. Keeps the best score per file path and returns at most
 * `maxRelated` entries sorted by score descending.
 */
function collectRelatedFiles(
  rawResults: SearchResult[],
  requestedFile: string,
  maxRelated: number
): RelatedFileEntry[] {
  if (maxRelated <= 0 || rawResults.length === 0) return [];

  const bestScore = new Map<string, number>();

  for (const r of rawResults) {
    const fp = r.chunk.metadata.filePath;
    if (fp === requestedFile) continue;
    const current = bestScore.get(fp);
    if (current === undefined || r.score > current) {
      bestScore.set(fp, r.score);
    }
  }

  return Array.from(bestScore.entries())
    .map(([filePath, score]) => ({ filePath, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRelated);
}
