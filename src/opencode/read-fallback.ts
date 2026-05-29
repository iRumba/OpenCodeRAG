import type { ReadNoResultsBehavior } from "../core/config.js";

/**
 * Fallback message when no OpenCodeRAG index exists or the index is empty.
 */
export function missingIndexMessage(): string {
  return [
    "OpenCodeRAG read override active.",
    "Full file read suppressed.",
    "",
    "No OpenCodeRAG index was found or the index is empty.",
    "",
    "Run:",
    "",
    "```bash",
    "npx tsx src/cli.ts index",
    "```",
    "",
    "Then retry the read request.",
  ].join("\n");
}

/**
 * Fallback message when the requested file has no indexed chunks.
 */
export function fileNotIndexedMessage(filePath: string): string {
  return [
    "OpenCodeRAG read override active.",
    "Full file read suppressed.",
    "",
    "No indexed chunks were found for:",
    `- ${filePath}`,
    "",
    "Possible reasons:",
    "- The file extension is not included.",
    "- The directory is excluded.",
    "- The index is stale.",
    "- The file was created after the last indexing run.",
    "",
    "Run:",
    "",
    "```bash",
    "npx tsx src/cli.ts index",
    "```",
  ].join("\n");
}

/**
 * Fallback message when no relevant chunks matched the read request.
 */
export function noRelevantChunksMessage(): string {
  return [
    "OpenCodeRAG read override active.",
    "Full file read suppressed.",
    "",
    "No relevant chunks were found for this read request.",
    "",
    "Try:",
    "- Ask a more specific question.",
    "- Run the index again.",
    "- Request a smaller line range if range fallback is enabled.",
  ].join("\n");
}

/**
 * Error message wrapper for retrieval failures.
 */
export function retrievalErrorMessage(shortError: string): string {
  return [
    "OpenCodeRAG retrieval failed.",
    "Full file read suppressed.",
    "",
    "Error:",
    shortError,
  ].join("\n");
}

/**
 * Dispatch to the correct fallback message based on behavior config.
 */
export function getNoResultsMessage(
  behavior: ReadNoResultsBehavior,
  filePath?: string
): string {
  switch (behavior) {
    case "error":
      throw new Error(
        "OpenCodeRAG read: no indexed chunks found." +
          (filePath ? ` File: ${filePath}` : "")
      );
    case "empty":
      return "OpenCodeRAG read override active. Full file read suppressed. No indexed chunks found.";
    case "hint":
    default:
      if (filePath) {
        return fileNotIndexedMessage(filePath);
      }
      return noRelevantChunksMessage();
  }
}
