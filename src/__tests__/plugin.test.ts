import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        retrieval: { topK: 7, minScore: 0 },
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
        retrieval: { topK: 7, minScore: 0 },
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
    assert.doesNotMatch(output.system[0]!, /read tool is also backed/);
  });

  it("suggests related files on chat.message", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/home/user/project/src/embedder/openai.ts",
        10,
        25,
        "typescript",
        "export class OpenAIProvider {}",
        0.92
      ),
      makeResult(
        "chunk-2",
        "/home/user/project/src/embedder/ollama.ts",
        5,
        15,
        "typescript",
        "export class OllamaProvider {}",
        0.85
      ),
    ];

    const { dependencies } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: "/home/user/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
        parts: [{
          type: "text",
          text: "show me the OpenAI API files",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-1",
        }],
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
    assert.match((output.parts[0] as Record<string, unknown>).text as string, /src\/embedder\/openai\.ts.*typescript/);
    assert.match((output.parts[0] as Record<string, unknown>).text as string, /src\/embedder\/ollama\.ts.*typescript/);
  });

  it("auto-injects chunk content when scores exceed threshold", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/project/src/auth.ts",
        12,
        30,
        "typescript",
        "export function login() {\n  const token = getToken();\n  return token;\n}",
        0.92
      ),
      makeResult(
        "chunk-2",
        "/project/src/auth.ts",
        40,
        55,
        "typescript",
        "export function validateToken(token: string): boolean {\n  return token.length > 0;\n}",
        0.88
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-2",
        parts: [{
          type: "text",
          text: "how does login work?",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-2",
        }],
      },
      parts: [{
        type: "text",
        text: "how does login work?",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-2",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-2" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /login\(\)/);
    assert.match(resultText, /validateToken/);
    assert.match(resultText, /auth\.ts:12-30/);
    assert.doesNotMatch(resultText, /Showing top.*relevant files/);
  });

  it("falls back to file list when scores are below autoInject threshold", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/project/src/auth.ts",
        12,
        30,
        "typescript",
        "export function login() {}",
        0.5
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-3",
        parts: [{
          type: "text",
          text: "auth stuff",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-3",
        }],
      },
      parts: [{
        type: "text",
        text: "auth stuff",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-3",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-3" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.doesNotMatch(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /Relevant files:/);
  });

  it("respects maxChunks limit for auto-injection", async () => {
    const results = [
      makeResult("c1", "/p/a.ts", 1, 10, "ts", "fn a() {}", 0.95),
      makeResult("c2", "/p/b.ts", 1, 10, "ts", "fn b() {}", 0.90),
      makeResult("c3", "/p/c.ts", 1, 10, "ts", "fn c() {}", 0.85),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 3,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 3);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.5, maxChunks: 1, maxTokens: 99999 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/p",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-4",
        parts: [{
          type: "text",
          text: "test",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-4",
        }],
      },
      parts: [{
        type: "text",
        text: "test",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-4",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-4" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /1 chunk/);
    assert.match(resultText, /fn a\(\)/);
    assert.doesNotMatch(resultText, /fn b\(\)/);
  });

  it("disabled autoInject falls back to file list", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/project/src/main.ts",
        1,
        10,
        "typescript",
        "export function main() {}",
        0.99
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: false, minScore: 0.75, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-5",
        parts: [{
          type: "text",
          text: "test",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-5",
        }],
      },
      parts: [{
        type: "text",
        text: "test",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-5",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-5" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.doesNotMatch(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /src\/main\.ts/);
  });

  it("uses relative paths in auto-injected context", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/home/user/workspace/src/app.ts",
        1,
        5,
        "typescript",
        "const x = 1;",
        0.95
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.5, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/home/user/workspace",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-6",
        parts: [{
          type: "text",
          text: "test",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-6",
        }],
      },
      parts: [{
        type: "text",
        text: "test",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-6",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-6" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(resultText, /src\/app\.ts/);
    assert.doesNotMatch(resultText, /home\/user\/workspace/);
  });

});
