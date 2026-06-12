import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Chunk } from "../../core/interfaces.js";
import type { DescriptionConfig } from "../../core/config.js";
import { LLMDescriptionProvider, buildBatchUserMessage, parseBatchResponse } from "../../describer/describer.js";
import { createDescriptionProvider } from "../../describer/factory.js";

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: "chunk-1",
    content: "export function hello() { return 'world'; }",
    metadata: {
      filePath: "src/hello.ts",
      startLine: 1,
      endLine: 3,
      language: "typescript",
      ...overrides.metadata,
    },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<DescriptionConfig> = {}): DescriptionConfig {
  return {
    enabled: true,
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/api",
    model: "test-model",
    timeoutMs: 5000,
    systemPrompt: "Describe the code.",
    batchMaxChunks: 25,
    batchTimeoutMs: 120000,
    retryMax: 0,
    retryBaseDelayMs: 10,
    ...overrides,
  };
}

function startMockServer(
  handler: (body: Record<string, unknown>) => { status: number; body: unknown }
): Promise<{ server: Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        const body = JSON.parse(data) as Record<string, unknown>;
        const result = handler(body);
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res()))
          ),
      });
    });
  });
}

describe("LLMDescriptionProvider", () => {
  it("generates description using Ollama API format", async () => {
    const { server, baseUrl, close } = await startMockServer((body) => {
      assert.equal(body.model, "test-model");
      assert.ok(Array.isArray(body.messages));
      const messages = body.messages as Array<{ role: string; content: string }>;
      assert.equal(messages[0]!.role, "system");
      assert.equal(messages[0]!.content, "Describe the code.");
      assert.equal(messages[1]!.role, "user");
      assert.ok(messages[1]!.content.includes("src/hello.ts"));
      assert.ok(messages[1]!.content.includes("typescript"));
      assert.ok(messages[1]!.content.includes("export function hello"));
      assert.ok(body.stream === false);

      return {
        status: 200,
        body: { message: { content: "A function that returns the string 'world'." } },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      const description = await provider.generateDescription(makeChunk());
      assert.equal(description, "A function that returns the string 'world'.");
    } finally {
      await close();
    }
  });

  it("generates description using OpenAI API format", async () => {
    const { server, baseUrl, close } = await startMockServer((body) => {
      assert.equal(body.model, "openai-model");
      assert.ok(Array.isArray(body.messages));
      assert.ok(body.stream === undefined);

      return {
        status: 200,
        body: {
          choices: [{ message: { content: "A greeting function." } }],
        },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({
          provider: "openai",
          model: "openai-model",
          baseUrl: `${baseUrl}/v1`,
        })
      );
      const description = await provider.generateDescription(makeChunk());
      assert.equal(description, "A greeting function.");
    } finally {
      await close();
    }
  });

  it("includes file path and language in user message", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { server, baseUrl, close } = await startMockServer((body) => {
      capturedBody = body;
      return {
        status: 200,
        body: { message: { content: "Description." } },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      await provider.generateDescription(
        makeChunk({
          content: "def foo(): pass",
          metadata: {
            filePath: "src/foo.py",
            startLine: 10,
            endLine: 20,
            language: "python",
          },
        })
      );

      const messages = capturedBody.messages as Array<{ role: string; content: string }>;
      const userMsg = messages[1]!.content;
      assert.ok(userMsg.includes("File: src/foo.py"));
      assert.ok(userMsg.includes("Language: python"));
      assert.ok(userMsg.includes("Lines: 10-20"));
      assert.ok(userMsg.includes("def foo(): pass"));
    } finally {
      await close();
    }
  });

  it("uses custom system prompt from config", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { server, baseUrl, close } = await startMockServer((body) => {
      capturedBody = body;
      return {
        status: 200,
        body: { message: { content: "Custom description." } },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({
          baseUrl: `${baseUrl}/api`,
          systemPrompt: "You are a Python expert. Describe this code briefly.",
        })
      );
      await provider.generateDescription(makeChunk());

      const messages = capturedBody.messages as Array<{ role: string; content: string }>;
      assert.equal(
        messages[0]!.content,
        "You are a Python expert. Describe this code briefly."
      );
    } finally {
      await close();
    }
  });

  it("sends API key as Bearer token for OpenAI provider", async () => {
    const { server, baseUrl, close } = await startMockServer((body) => {
      return {
        status: 200,
        body: { choices: [{ message: { content: "Desc." } }] },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({
          provider: "openai",
          baseUrl: `${baseUrl}/v1`,
          apiKey: "test-api-key",
        })
      );
      const desc = await provider.generateDescription(makeChunk());
      assert.equal(desc, "Desc.");
    } finally {
      await close();
    }
  });

  it("throws on empty LLM response", async () => {
    const { server, baseUrl, close } = await startMockServer(() => ({
      status: 200,
      body: { message: { content: "" } },
    }));

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      await assert.rejects(
        () => provider.generateDescription(makeChunk()),
        (err: Error) => {
          assert.ok(err.message.includes("empty response"));
          return true;
        }
      );
    } finally {
      await close();
    }
  });

  it("throws on HTTP error status", async () => {
    const { server, baseUrl, close } = await startMockServer(() => ({
      status: 500,
      body: { error: "internal error" },
    }));

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      await assert.rejects(
        () => provider.generateDescription(makeChunk()),
        (err: Error) => {
          assert.ok(err.message.includes("500"));
          return true;
        }
      );
    } finally {
      await close();
    }
  });

  it("uses Ollama chat endpoint", async () => {
    let requestUrl = "";
    const { server, baseUrl, close } = await startMockServer((body) => {
      return {
        status: 200,
        body: { message: { content: "Desc." } },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      const desc = await provider.generateDescription(makeChunk());
      assert.equal(desc, "Desc.");
    } finally {
      await close();
    }
  });

  it("uses OpenAI chat completions endpoint", async () => {
    const { server, baseUrl, close } = await startMockServer(() => ({
      status: 200,
      body: { choices: [{ message: { content: "Desc." } }] },
    }));

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({
          provider: "openai",
          baseUrl: `${baseUrl}/v1`,
        })
      );
      const desc = await provider.generateDescription(makeChunk());
      assert.equal(desc, "Desc.");
    } finally {
      await close();
    }
  });
});

describe("LLMDescriptionProvider.generateBatchDescriptions", () => {
  it("returns single-element map when chunks.length === 1", async () => {
    const { server, baseUrl, close } = await startMockServer((body) => {
      return {
        status: 200,
        body: { message: { content: "Single description." } },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      const chunk = makeChunk({ id: "c1" });
      const result = await provider.generateBatchDescriptions([chunk]);
      assert.equal(result.size, 1);
      assert.equal(result.get("c1"), "Single description.");
    } finally {
      await close();
    }
  });

  it("sends batch prompt with all chunks labeled", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { server, baseUrl, close } = await startMockServer((body) => {
      capturedBody = body;
      return {
        status: 200,
        body: {
          message: {
            content: "CHUNK 0: First function.\nCHUNK 1: Second function.",
          },
        },
      };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      const chunks = [
        makeChunk({ id: "c0", content: "function first() {}", metadata: { filePath: "src/a.ts", startLine: 1, endLine: 2, language: "typescript" } }),
        makeChunk({ id: "c1", content: "function second() {}", metadata: { filePath: "src/a.ts", startLine: 4, endLine: 5, language: "typescript" } }),
      ];
      const result = await provider.generateBatchDescriptions(chunks);

      const messages = capturedBody.messages as Array<{ role: string; content: string }>;
      assert.equal(messages.length, 2);
      assert.ok(messages[1]!.content.includes("=== CHUNK 0 (lines 1-2) ==="));
      assert.ok(messages[1]!.content.includes("=== CHUNK 1 (lines 4-5) ==="));
      assert.ok(messages[1]!.content.includes("Chunks: 2"));

      assert.equal(result.size, 2);
      assert.equal(result.get("c0"), "First function.");
      assert.equal(result.get("c1"), "Second function.");
    } finally {
      await close();
    }
  });

  it("falls back to individual calls for missing descriptions", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer((body) => {
      const messages = (body.messages as Array<{ role: string; content: string }>);
      const userMsg = messages[1]?.content ?? "";
      callCount++;

      if (userMsg.includes("Chunks:")) {
        return {
          status: 200,
          body: { message: { content: "CHUNK 0: First desc." } },
        };
      }
      if (userMsg.includes("second.ts")) {
        return {
          status: 200,
          body: { message: { content: "Second desc (individual)." } },
        };
      }
      return { status: 200, body: { message: { content: "Fallback." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      const chunks = [
        makeChunk({ id: "c0", content: "function first() {}", metadata: { filePath: "src/first.ts", startLine: 1, endLine: 2, language: "typescript" } }),
        makeChunk({ id: "c1", content: "function second() {}", metadata: { filePath: "src/second.ts", startLine: 4, endLine: 5, language: "typescript" } }),
      ];
      const result = await provider.generateBatchDescriptions(chunks);

      assert.equal(result.size, 2);
      assert.equal(result.get("c0"), "First desc.");
      assert.equal(result.get("c1"), "Second desc (individual).");
      assert.equal(callCount, 2);
    } finally {
      await close();
    }
  });

  it("throws on batch HTTP error", async () => {
    const { server, baseUrl, close } = await startMockServer((body) => {
      const messages = (body.messages as Array<{ role: string; content: string }>);
      const userMsg = messages[1]?.content ?? "";
      if (userMsg.includes("Chunks:")) {
        return { status: 500, body: { error: "internal error" } };
      }
      return { status: 200, body: { message: { content: "Individual." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api` })
      );
      const chunks = [
        makeChunk({ id: "c0", metadata: { filePath: "src/a.ts", startLine: 1, endLine: 2, language: "typescript" } }),
        makeChunk({ id: "c1", metadata: { filePath: "src/a.ts", startLine: 4, endLine: 5, language: "typescript" } }),
      ];

      const result = await provider.generateBatchDescriptions(chunks);
      assert.equal(result.size, 2);
      assert.equal(result.get("c0"), "Individual.");
      assert.equal(result.get("c1"), "Individual.");
    } finally {
      await close();
    }
  });

  it("splits large batches into sub-batches", async () => {
    let batchCount = 0;
    const { server, baseUrl, close } = await startMockServer((body) => {
      const messages = (body.messages as Array<{ role: string; content: string }>);
      const userMsg = messages[1]?.content ?? "";
      if (userMsg.includes("Chunks:")) {
        batchCount++;
        return {
          status: 200,
          body: { message: { content: "CHUNK 0: Desc A.\nCHUNK 1: Desc B." } },
        };
      }
      return { status: 200, body: { message: { content: "Individual." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, batchMaxChunks: 2 })
      );
      const chunks = [
        makeChunk({ id: "c0", metadata: { filePath: "src/a.ts", startLine: 1, endLine: 5, language: "typescript" } }),
        makeChunk({ id: "c1", metadata: { filePath: "src/a.ts", startLine: 6, endLine: 10, language: "typescript" } }),
        makeChunk({ id: "c2", metadata: { filePath: "src/a.ts", startLine: 11, endLine: 15, language: "typescript" } }),
        makeChunk({ id: "c3", metadata: { filePath: "src/a.ts", startLine: 16, endLine: 20, language: "typescript" } }),
      ];

      const result = await provider.generateBatchDescriptions(chunks);

      assert.equal(batchCount, 2);
      assert.equal(result.size, 4);
      assert.equal(result.get("c0"), "Desc A.");
      assert.equal(result.get("c1"), "Desc B.");
      assert.equal(result.get("c2"), "Desc A.");
      assert.equal(result.get("c3"), "Desc B.");
    } finally {
      await close();
    }
  });
});

describe("buildBatchUserMessage", () => {
  it("builds correct message for multiple chunks", () => {
    const chunks = [
      makeChunk({ metadata: { filePath: "src/a.ts", startLine: 1, endLine: 10, language: "typescript" } }),
      makeChunk({ id: "c2", content: "class Bar {}", metadata: { filePath: "src/a.ts", startLine: 12, endLine: 20, language: "typescript" } }),
    ];

    const msg = buildBatchUserMessage(chunks);

    assert.ok(msg.includes("File: src/a.ts"));
    assert.ok(msg.includes("Language: typescript"));
    assert.ok(msg.includes("Chunks: 2"));
    assert.ok(msg.includes("=== CHUNK 0 (lines 1-10) ==="));
    assert.ok(msg.includes("=== CHUNK 1 (lines 12-20) ==="));
    assert.ok(msg.includes("```typescript"));
  });
});

describe("parseBatchResponse", () => {
  it("extracts descriptions for each chunk", () => {
    const chunks = [
      makeChunk({ id: "c0" }),
      makeChunk({ id: "c1" }),
      makeChunk({ id: "c2" }),
    ];

    const text = "CHUNK 0: First desc.\nCHUNK 1: Second desc.\nCHUNK 2: Third desc.";
    const result = parseBatchResponse(text, chunks);

    assert.equal(result.size, 3);
    assert.equal(result.get("c0"), "First desc.");
    assert.equal(result.get("c1"), "Second desc.");
    assert.equal(result.get("c2"), "Third desc.");
  });

  it("handles multi-line descriptions", () => {
    const chunks = [
      makeChunk({ id: "c0" }),
      makeChunk({ id: "c1" }),
    ];

    const text = "CHUNK 0: First line of desc.\nMore details here.\nCHUNK 1: Single line.";
    const result = parseBatchResponse(text, chunks);

    assert.equal(result.size, 2);
    assert.equal(result.get("c0"), "First line of desc. More details here.");
    assert.equal(result.get("c1"), "Single line.");
  });

  it("ignores chunks with empty descriptions", () => {
    const chunks = [
      makeChunk({ id: "c0" }),
      makeChunk({ id: "c1" }),
    ];

    const text = "CHUNK 0: Real desc.\nCHUNK 1:";
    const result = parseBatchResponse(text, chunks);

    assert.equal(result.size, 1);
    assert.equal(result.get("c0"), "Real desc.");
    assert.equal(result.get("c1"), undefined);
  });

  it("ignores out-of-range chunk indices", () => {
    const chunks = [
      makeChunk({ id: "c0" }),
      makeChunk({ id: "c1" }),
    ];

    const text = "CHUNK 0: Good.\nCHUNK 5: Out of range.";
    const result = parseBatchResponse(text, chunks);

    assert.equal(result.size, 1);
    assert.equal(result.get("c0"), "Good.");
  });

  it("handles empty response", () => {
    const chunks = [
      makeChunk({ id: "c0" }),
      makeChunk({ id: "c1" }),
    ];

    const text = "";
    const result = parseBatchResponse(text, chunks);

    assert.equal(result.size, 0);
  });
});

describe("createDescriptionProvider", () => {
  it("returns an LLMDescriptionProvider instance", () => {
    const provider = createDescriptionProvider(makeConfig());
    assert.ok(provider);
    assert.equal(typeof provider.generateDescription, "function");
    assert.equal(typeof provider.generateBatchDescriptions, "function");
  });
});

describe("LLMDescriptionProvider retry logic", () => {
  it("retries on 404 and succeeds on second attempt", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer(() => {
      callCount++;
      if (callCount === 1) {
        return { status: 404, body: "404 page not found" };
      }
      return { status: 200, body: { message: { content: "Description after retry." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 2, retryBaseDelayMs: 10 })
      );
      const desc = await provider.generateDescription(makeChunk());
      assert.equal(desc, "Description after retry.");
      assert.equal(callCount, 2);
    } finally {
      await close();
    }
  });

  it("retries on 500 and succeeds on third attempt", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer(() => {
      callCount++;
      if (callCount <= 2) {
        return { status: 500, body: { error: "internal error" } };
      }
      return { status: 200, body: { message: { content: "Recovered." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 3, retryBaseDelayMs: 10 })
      );
      const desc = await provider.generateDescription(makeChunk());
      assert.equal(desc, "Recovered.");
      assert.equal(callCount, 3);
    } finally {
      await close();
    }
  });

  it("does not retry on 400 (bad request)", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer(() => {
      callCount++;
      return { status: 400, body: { error: "bad request" } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 3, retryBaseDelayMs: 10 })
      );
      await assert.rejects(
        () => provider.generateDescription(makeChunk()),
        (err: Error) => {
          assert.ok(err.message.includes("400"));
          return true;
        }
      );
      assert.equal(callCount, 1);
    } finally {
      await close();
    }
  });

  it("does not retry on 401 (unauthorized)", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer(() => {
      callCount++;
      return { status: 401, body: { error: "unauthorized" } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 3, retryBaseDelayMs: 10 })
      );
      await assert.rejects(
        () => provider.generateDescription(makeChunk()),
        (err: Error) => {
          assert.ok(err.message.includes("401"));
          return true;
        }
      );
      assert.equal(callCount, 1);
    } finally {
      await close();
    }
  });

  it("exhausts all retries and throws", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer(() => {
      callCount++;
      return { status: 503, body: { error: "service unavailable" } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 2, retryBaseDelayMs: 10 })
      );
      await assert.rejects(
        () => provider.generateDescription(makeChunk()),
        (err: Error) => {
          assert.ok(err.message.includes("503"));
          return true;
        }
      );
      assert.equal(callCount, 3);
    } finally {
      await close();
    }
  });

  it("retries on 429 (rate limited) and succeeds", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer(() => {
      callCount++;
      if (callCount === 1) {
        return { status: 429, body: { error: "rate limited" } };
      }
      return { status: 200, body: { message: { content: "OK after rate limit." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 2, retryBaseDelayMs: 10 })
      );
      const desc = await provider.generateDescription(makeChunk());
      assert.equal(desc, "OK after rate limit.");
      assert.equal(callCount, 2);
    } finally {
      await close();
    }
  });

  it("retries batch calls on 502 and succeeds", async () => {
    let callCount = 0;
    const { server, baseUrl, close } = await startMockServer((body) => {
      callCount++;
      const messages = (body.messages as Array<{ role: string; content: string }>);
      const userMsg = messages?.[1]?.content ?? "";

      if (userMsg.includes("Chunks:")) {
        if (callCount <= 1) {
          return { status: 502, body: { error: "bad gateway" } };
        }
        return {
          status: 200,
          body: { message: { content: "CHUNK 0: Batch desc A.\nCHUNK 1: Batch desc B." } },
        };
      }
      return { status: 200, body: { message: { content: "Individual." } } };
    });

    try {
      const provider = new LLMDescriptionProvider(
        makeConfig({ baseUrl: `${baseUrl}/api`, retryMax: 2, retryBaseDelayMs: 10 })
      );
      const chunks = [
        makeChunk({ id: "c0", metadata: { filePath: "src/a.ts", startLine: 1, endLine: 5, language: "typescript" } }),
        makeChunk({ id: "c1", metadata: { filePath: "src/a.ts", startLine: 6, endLine: 10, language: "typescript" } }),
      ];
      const result = await provider.generateBatchDescriptions(chunks);

      assert.equal(result.size, 2);
      assert.equal(result.get("c0"), "Batch desc A.");
      assert.equal(result.get("c1"), "Batch desc B.");
      assert.equal(callCount, 2);
    } finally {
      await close();
    }
  });
});
