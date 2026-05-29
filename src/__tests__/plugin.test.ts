import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";
import { createRagHooks, ragPlugin } from "../plugin.js";
import { DEFAULT_CONFIG, type RagConfig } from "../core/config.js";
import type { EmbeddingProvider, SearchResult, VectorStore } from "../core/interfaces.js";

function makeConfig(overrides: Partial<RagConfig> = {}): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    embedding: {
      ...DEFAULT_CONFIG.embedding,
      ...overrides.embedding,
    },
    indexing: {
      ...DEFAULT_CONFIG.indexing,
      ...overrides.indexing,
    },
    vectorStore: {
      ...DEFAULT_CONFIG.vectorStore,
      ...overrides.vectorStore,
    },
    retrieval: {
      ...DEFAULT_CONFIG.retrieval,
      ...overrides.retrieval,
    },
    openCode: {
      ...DEFAULT_CONFIG.openCode,
      ...overrides.openCode,
    },
    chunkers: overrides.chunkers ?? DEFAULT_CONFIG.chunkers,
  };
}

function makeResult(
  id: string,
  filePath: string,
  startLine: number,
  endLine: number,
  language: string,
  content: string,
  score: number
): SearchResult {
  return {
    score,
    chunk: {
      id,
      content,
      metadata: { filePath, startLine, endLine, language },
    },
  };
}

const testWorktree = process.cwd();

const dummyProvider: EmbeddingProvider = {
  name: "test",
  embed: async () => [],
};

const dummyStore: VectorStore = {
  addChunks: async () => {},
  search: async () => [],
  count: async () => 0,
  clear: async () => {},
  deleteByFilePath: async () => {},
};

const populatedStore: VectorStore = {
  addChunks: async () => {},
  search: async () => [],
  count: async () => 5,
  clear: async () => {},
  deleteByFilePath: async () => {},
};

type SeenRetrieveCall = {
  query: string;
  topK: number;
};

function makeDependencies(
  results: SearchResult[],
  count: number
): {
  dependencies: { retrieve: typeof retrieve };
  getSeen: () => SeenRetrieveCall;
} {
  let seen: SeenRetrieveCall = { query: "", topK: 0 };

  const retrieve = async (
    query: string,
    _embedder: EmbeddingProvider,
    _store: VectorStore,
    options?: { topK?: number }
  ): Promise<SearchResult[]> => {
    seen = { query, topK: options?.topK ?? 0 };
    return results;
  };

  return {
    dependencies: { retrieve },
    getSeen: () => seen,
  };
}

function makeToolContext(): Record<string, unknown> {
  return {
    sessionID: "session-test",
    callID: "call-test",
    agent: "test",
  };
}

describe("ragPlugin", () => {
  it("loads config per workspace directory", async () => {
    const disabledDir = mkdtempSync(path.join(tmpdir(), "opencode-rag-disabled-"));
    const enabledDir = mkdtempSync(path.join(tmpdir(), "opencode-rag-enabled-"));

    try {
      writeFileSync(
        path.join(disabledDir, "opencode-rag.json"),
        JSON.stringify({ openCode: { enabled: false } })
      );
      writeFileSync(
        path.join(enabledDir, "opencode-rag.json"),
        JSON.stringify({ openCode: { enabled: true } })
      );

      const disabledHooks = await ragPlugin({ directory: disabledDir } as PluginInput, {});
      assert.deepStrictEqual(disabledHooks, {});

      const enabledHooks = await ragPlugin({ directory: enabledDir } as PluginInput, {});
      assert.equal(typeof enabledHooks["chat.message"], "function");
      assert.ok(enabledHooks.tool?.["opencode-rag-context"]);
    } finally {
      rmSync(disabledDir, { recursive: true, force: true });
      rmSync(enabledDir, { recursive: true, force: true });
    }
  });

  it("exposes an explicit chunk retrieval tool", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "src/plugin.ts",
        12,
        20,
        "typescript",
        "export function chunkEntryPoint() { return true; }",
        0.93
      ),
      makeResult(
        "chunk-2",
        "src/retriever/retriever.ts",
        1,
        30,
        "typescript",
        "export async function retrieve() { /* ... */ }",
        0.82
      ),
    ];

    const { dependencies, getSeen } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        retrieval: { topK: 7 },
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: testWorktree,
    });

    const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
    assert.ok(retrievalTool, "expected chunk retrieval tool to be registered");

    const readTool = hooks.tool?.read;
    assert.ok(readTool, "expected RAG-backed read tool to be registered");

    const result = await retrievalTool.execute(
      {
        query: "Locate the chunking entry point",
        pathHints: ["src/plugin.ts"],
        languageHints: ["typescript"],
        topK: 4,
      },
      makeToolContext() as never
    );

    assert.notEqual(typeof result, "string");
    const structured = result as {
      title?: string;
      output: string;
      metadata?: Record<string, unknown>;
    };

    assert.equal(structured.title, "OpenCodeRAG context (2 chunks)");
    assert.match(structured.output, /opencode-rag retrieved context/);
    assert.match(structured.output, /src\/plugin\.ts:12-20/);
    assert.match(structured.output, /src\/retriever\/retriever\.ts:1-30/);
    assert.match(structured.output, /chunkEntryPoint/);
    assert.equal(structured.metadata?.chunks, 2);
    assert.deepStrictEqual(structured.metadata?.pathHints, ["src/plugin.ts"]);
    assert.deepStrictEqual(structured.metadata?.languageHints, ["typescript"]);

    const seen = getSeen();
    assert.match(seen.query, /Locate the chunking entry point/);
    assert.match(seen.query, /Path hints: src\/plugin\.ts/);
    assert.match(seen.query, /Language hints: typescript/);
    assert.equal(seen.topK, 4);
  });

  it("writes multiline chunk contents to the log file", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "opencode-rag-log-"));

    try {
      const results = [
        makeResult(
          "chunk-1",
          "src/plugin.ts",
          12,
          20,
          "typescript",
          "export function chunkEntryPoint() {\n  return true;\n}\n",
          0.93
        ),
      ];

      const { dependencies } = makeDependencies(results, 1);
      const logFilePath = path.join(tempDir, ".opencode", "opencode-rag.log");
      const hooks = createRagHooks({
        cfg: makeConfig({
          retrieval: { topK: 7 },
          openCode: { enabled: true, maxContextChunks: 5 },
        }),
        storePath: "memory://",
        logFilePath,
        store: populatedStore,
        dependencies,
        worktree: testWorktree,
      });

      const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
      assert.ok(retrievalTool, "expected chunk retrieval tool to be registered");

      await retrievalTool.execute(
        {
          query: "Locate the chunking entry point",
          pathHints: ["src/plugin.ts"],
          languageHints: ["typescript"],
          topK: 4,
        },
        makeToolContext() as never
      );

      const logContent = readFileSync(logFilePath, "utf8");
      assert.ok(logContent.includes("  export function chunkEntryPoint() {\n    return true;\n  }"));
      assert.ok(!logContent.includes("export function chunkEntryPoint() {\\n  return true;\\n}"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns a helpful message when the index is empty", async () => {
    const { dependencies } = makeDependencies([], 0);
    const hooks = createRagHooks({
      cfg: makeConfig(),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies: {
        ...dependencies,
        retrieve: async () => {
          assert.fail("retrieve should not run when the index is empty");
        },
      },
      worktree: testWorktree,
    });

    const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
    assert.ok(retrievalTool);

    const result = await retrievalTool!.execute(
      { query: "anything" },
      makeToolContext() as never
    );

    assert.notEqual(typeof result, "string");
    const structured = result as {
      title?: string;
      output: string;
      metadata?: Record<string, unknown>;
    };

    assert.equal(structured.title, "OpenCodeRAG context");
    assert.match(structured.output, /No indexed chunks are available yet/);
    assert.equal(structured.metadata?.indexed, false);
    assert.equal(structured.metadata?.chunks, 0);
  });

  it("adds system guidance for chunk retrieval", async () => {
    const { dependencies } = makeDependencies([], 1);
    const hooks = createRagHooks({
      cfg: makeConfig(),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies,
      worktree: testWorktree,
    });

    const systemHook = hooks["experimental.chat.system.transform"];
    assert.ok(systemHook);

    const output = { system: [] as string[] };
    await systemHook?.({ model: { providerID: "test", modelID: "test" } } as never, output as never);

    assert.ok(output.system.length > 0);
    assert.match(output.system[0]!, /opencode-rag-context/);
    assert.match(output.system[0]!, /Use it before planning/);
  });

  it("does not retrieve context on chat.message (retrieval only on file tool scans)", async () => {
    const retrieveShouldNotRun = async () => {
      assert.fail("retrieve should not run on chat.message");
    };

    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies: { retrieve: retrieveShouldNotRun },
      worktree: testWorktree,
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
      },
      parts: [{
        type: "text",
        text: "show me the OpenAI API files",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-1",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-1" } as never, output as never);

    assert.equal(output.parts.length, 1);
  });

  it("registers a RAG-backed read override tool", async () => {
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      worktree: testWorktree,
    });

    const readTool = hooks.tool?.read;
    assert.ok(readTool, "expected RAG-backed read tool to be registered");
    assert.ok(typeof readTool === "object" && readTool !== null);
    assert.ok("execute" in readTool);

    const result = await (readTool as { execute: Function }).execute(
      {
        filePath: "src/embedder/openai.ts",
        query: "OpenAI provider implementation",
      },
      {} as never
    );

    assert.notEqual(typeof result, "string");
    const structured = result as {
      title?: string;
      output: string;
      metadata?: Record<string, unknown>;
    };

    assert.ok(structured.title);
    assert.match(structured.title!, /OpenCodeRAG/);
    assert.match(structured.output, /OpenCodeRAG read override active/);
  });

  it("does not replace output for non-read search tools", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "src/embedder/openai.ts",
        5,
        12,
        "typescript",
        "export class OpenAIProvider implements EmbeddingProvider {}",
        0.97
      ),
    ];

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: testWorktree,
    });

    const toolAfterHook = hooks["tool.execute.after"];
    assert.ok(toolAfterHook);

    const grepOutput = "src/embedder/openai.ts:1:export class OpenAIProvider";
    const output = {
      title: "Grep result",
      output: grepOutput,
      metadata: null,
    };

    await toolAfterHook?.(
      {
        tool: "grep",
        sessionID: "session-1",
        callID: "call-2",
      } as never,
      output as never
    );

    assert.match(output.output, /opencode-rag retrieved context/);
    assert.match(output.output, /src\/embedder\/openai.ts:1:export class OpenAIProvider/);
  });
});
