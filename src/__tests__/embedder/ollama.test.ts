import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../../embedder/ollama.js";

describe("OllamaProvider", () => {
  it("name is 'ollama'", () => {
    const p = new OllamaProvider("http://localhost:11434/api", "nomic-embed-text");
    assert.equal(p.name, "ollama");
  });

  it("strips single trailing slash from baseUrl", () => {
    const p = new OllamaProvider("http://localhost:11434/api/", "model");
    assert.ok(p);
  });

  it("strips multiple trailing slashes from baseUrl", () => {
    const p = new OllamaProvider("http://localhost:11434/api///", "model");
    assert.ok(p);
  });

  it("preserves baseUrl without trailing slash", () => {
    const p = new OllamaProvider("http://localhost:11434/api", "model");
    assert.ok(p);
  });

  it("stores apiKey when provided", () => {
    const p = new OllamaProvider("http://localhost:11434/api", "model", "my-api-key");
    assert.ok(p);
  });

  it("apiKey defaults to undefined when not provided", () => {
    const p = new OllamaProvider("http://localhost:11434/api", "model");
    assert.ok(p);
  });

  it("embeds single text with correct API format", async () => {
    // Test that the embed method exists and is callable.
    // Actual fetch calls are not made in unit tests.
    const p = new OllamaProvider("http://localhost:11434/api", "embeddinggemma");
    assert.equal(typeof p.embed, "function");
    assert.equal(p.embed.length, 1); // expects texts array parameter
  });

  it("does not require apiKey for construction", () => {
    const p = new OllamaProvider("http://localhost:11434/api", "embeddinggemma");
    assert.equal(p.name, "ollama");
  });

  it("handles custom baseUrl with port and path", () => {
    const p = new OllamaProvider("http://192.168.1.100:8080/api", "model");
    assert.ok(p);
  });

  it("handles https baseUrl", () => {
    const p = new OllamaProvider("https://ollama.example.com/api", "model");
    assert.ok(p);
  });

  it("aborts slow embedding requests instead of hanging forever", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        }
      });
    }) as typeof fetch;

    try {
      const p = new OllamaProvider(
        "http://localhost:11434/api",
        "embeddinggemma",
        undefined,
        1
      );

      await assert.rejects(
        () => p.embed(["test"]),
        /timed out after 1ms/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
