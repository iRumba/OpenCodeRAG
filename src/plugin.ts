import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import type { Chunk, SearchResult } from "./core/interfaces.js";
import { loadConfig, DEFAULT_CONFIG, type RagConfig } from "./core/config.js";
import { createEmbedder } from "./embedder/factory.js";
import { LanceDBStore } from "./vectorstore/lancedb.js";
import { retrieve } from "./retriever/retriever.js";
import { loadChunkersFromConfig } from "./chunker/loader.js";
import path from "node:path";

let config: RagConfig | null = null;

const SEARCH_TOOLS = new Set(["glob", "grep", "read", "list"]);

type TextPart = {
  type: "text";
  text: string;
};

type MessagePartsOutput = {
  parts: Array<{ type?: string; text?: string }>;
};

type ToolExecuteAfterOutput = {
  title: string;
  output: string;
  metadata: unknown;
};

async function getConfig(directory: string): Promise<RagConfig> {
  if (config) return config;

  for (const loc of ["opencode-rag.json", ".opencode/rag.json"]) {
    try {
      const configPath = path.join(directory, loc);
      const cfg = loadConfig(configPath);
      await loadChunkersFromConfig(cfg, path.dirname(configPath));
      config = cfg;
      return config;
    } catch {
      // continue
    }
  }

  config = DEFAULT_CONFIG;
  return config;
}

function formatContext(
  results: Awaited<ReturnType<typeof retrieve>>
): string {
  if (results.length === 0) return "";

  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  const parts: string[] = [];
  parts.push("\n🧠 **opencode-rag retrieved context** _(context: " + results.length + " chunks, avg relevance: " + avgScore.toFixed(2) + ")_\n");
  parts.push("---\n");

  for (const r of results) {
    const m = r.chunk.metadata;
    parts.push(
      `[${m.filePath}:${m.startLine}-${m.endLine}] (${m.language}, score: ${r.score.toFixed(2)})`
    );
    parts.push("```" + m.language);
    parts.push(r.chunk.content);
    parts.push("```\n");
  }

  parts.push("---\n");
  return parts.join("\n");
}

function getQueryFromParts(output: MessagePartsOutput): string {
  const queryTexts: string[] = [];

  for (const part of output.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      queryTexts.push(part.text);
    }
  }

  return queryTexts.join("\n").trim();
}

function hasInjectedContext(parts: Array<{ type?: string; text?: string }>): boolean {
  return parts.some(
    (part) => part.type === "text" && typeof part.text === "string" && part.text.includes("opencode-rag retrieved context")
  );
}

function normalizeToolOutput(output: string): string {
  return output.replace(/\r\n/g, "\n").trim();
}

function buildToolQuery(tool: string, output: string): string {
  const normalized = normalizeToolOutput(output);
  if (!normalized) return "";

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 40);

  if (lines.length === 0) return "";

  return [
    `OpenCode used the ${tool} tool while searching for relevant files and code.`,
    "Use these discovered paths and matches as retrieval hints:",
    ...lines,
  ].join("\n");
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const chunk = result.chunk;
    const key = [
      chunk.metadata.filePath,
      chunk.metadata.startLine,
      chunk.metadata.endLine,
      chunk.content,
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

async function retrieveContext(
  query: string,
  embedder: ReturnType<typeof createEmbedder>,
  store: LanceDBStore,
  topK: number
): Promise<SearchResult[]> {
  if (query.trim().length === 0) return [];
  return retrieve(query, embedder, store, { topK });
}

async function appendRetrievedContext(
  query: string,
  output: MessagePartsOutput,
  store: LanceDBStore,
  embedder: ReturnType<typeof createEmbedder>,
  cfg: RagConfig,
  extraQuery?: string
): Promise<void> {
  if (hasInjectedContext(output.parts)) return;

  const primaryResults = await retrieveContext(query, embedder, store, cfg.retrieval.topK);
  const extraResults = extraQuery
    ? await retrieveContext(extraQuery, embedder, store, cfg.retrieval.topK)
    : [];

  const merged = dedupeResults([...primaryResults, ...extraResults])
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.openCode.maxContextChunks);

  if (merged.length === 0) return;

  output.parts.push({
    type: "text",
    text: formatContext(merged),
  });
}

export const ragPlugin: Plugin = async (
  input: PluginInput,
  _options?: Record<string, unknown>
): Promise<Hooks> => {
  const cfg = await getConfig(input.directory);

  if (!cfg.openCode.enabled) {
    return {};
  }

  const embedder = createEmbedder(cfg);
  const storePath = path.resolve(input.directory, cfg.vectorStore.path);

  return {
    async "chat.message"(_input, output) {
      try {
        const store = new LanceDBStore(storePath);
        const count = await store.count();

        if (count === 0) return; // Nothing indexed yet

        const query = getQueryFromParts(output);
        if (query.length === 0) return;

        await appendRetrievedContext(query, output, store, embedder, cfg);
      } catch (err) {
        // Silently fail - don't break the user's chat if RAG fails
        console.error("[opencode-rag] chat.message hook error:", err);
      }
    },
    async "tool.execute.after"(hookInput, output) {
      try {
        if (!SEARCH_TOOLS.has(hookInput.tool)) return;

        const toolOutput = typeof output.output === "string" ? output.output : "";
        const extraQuery = buildToolQuery(hookInput.tool, toolOutput);
        if (extraQuery.length === 0) return;

        const store = new LanceDBStore(storePath);
        const count = await store.count();
        if (count === 0) return;

        const context = formatContext(
          dedupeResults(
            await retrieveContext(extraQuery, embedder, store, cfg.openCode.maxContextChunks)
          )
        );

        if (!context) return;

        output.output = `${toolOutput}\n${context}`.trim();
      } catch (err) {
        console.error("[opencode-rag] tool.execute.after hook error:", err);
      }
    },
  };
};

export default ragPlugin;
