import type { SearchResult } from "../core/interfaces.js";

/**
 * Options for formatting read tool output.
 */
export interface FormatReadOutputOptions {
  /** The requested file path (display-friendly). */
  filePath: string;
  /** The retrieval query used. */
  retrievalQuery: string;
  /** Search results to format. */
  results: SearchResult[];
  /** Maximum results to include. */
  maxChunks: number;
  /** Maximum output character count. */
  maxChars: number;
}

/**
 * Format RAG retrieval results for the read tool output.
 *
 * The output:
 *   - Clearly states full-file reading was suppressed.
 *   - Includes request metadata (file path, query, chunk count).
 *   - Formats each chunk with file path, line range, score, and code block.
 *   - Enforces maxChars limit and appends truncation notice.
 *
 * Returns a string ready to return as the tool output.
 */
export function formatReadOutput(options: FormatReadOutputOptions): string {
  const { filePath, retrievalQuery, results, maxChunks, maxChars } = options;

  const header = buildHeader(filePath, retrievalQuery, results.length, maxChunks);
  let output = header;

  const limited = results.slice(0, maxChunks);

  for (let i = 0; i < limited.length; i++) {
    const r = limited[i];
    if (!r) continue;
    const chunkPart = formatChunk(i + 1, r);

    // Check if adding this chunk would exceed the limit
    if ((output + "\n" + chunkPart).length > maxChars) {
      // If we already have some content, append truncation notice
      const truncationNotice =
        "\n\n---\nOutput truncated by OpenCodeRAG to stay within maxReadOutputChars.\nUse a more specific query or line range to retrieve narrower context.";
      if ((output + truncationNotice).length <= maxChars) {
        output += truncationNotice;
      }
      break;
    }

    if (i > 0) {
      output += "\n";
    }
    output += chunkPart;
  }

  return output;
}

function buildHeader(
  filePath: string,
  retrievalQuery: string,
  totalResults: number,
  maxChunks: number
): string {
  const parts: string[] = [
    "OpenCodeRAG read override active.",
    "Full file read suppressed. Returning relevant indexed chunks instead.",
    "",
    "Requested file:",
    `- ${filePath}`,
    "",
    "Retrieval query:",
    `- ${retrievalQuery.split("\n")[0]}` +
      (retrievalQuery.includes("\n") ? "..." : ""),
    "",
    `Returned chunks:`,
    `- ${Math.min(totalResults, maxChunks)} of max ${maxChunks}`,
    "",
  ];
  return parts.join("\n");
}

function formatChunk(index: number, result: SearchResult): string {
  const { chunk, score } = result;
  const metadata = chunk.metadata;
  const language = metadata.language || "";
  const lines: string[] = [];

  lines.push(`## Chunk ${index}`);
  lines.push(`File: ${metadata.filePath}`);
  lines.push(`Lines: ${metadata.startLine}-${metadata.endLine}`);
  lines.push(`Score: ${score.toFixed(4)}`);
  lines.push("");
  lines.push("```" + language);
  lines.push(chunk.content);
  if (!chunk.content.endsWith("\n")) {
    // Ensure code block closes on its own line
  }
  lines.push("```");

  return lines.join("\n");
}
