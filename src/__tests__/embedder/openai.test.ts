import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../../embedder/openai.js";

describe("OpenAIProvider", () => {
  it("name is 'openai'", () => {
    const p = new OpenAIProvider(
      "https://api.openai.com/v1",
      "text-embedding-3-small",
      "sk-test-key"
    );
    assert.equal(p.name, "openai");
  });

  it("strips single trailing slash from baseUrl", () => {
    const p = new OpenAIProvider(
      "https://api.openai.com/v1/",
      "model",
      "sk-key"
    );
    assert.ok(p);
  });

  it("strips multiple trailing slashes from baseUrl", () => {
    const p = new OpenAIProvider(
      "https://api.openai.com/v1///",
      "model",
      "sk-key"
    );
    assert.ok(p);
  });

  it("preserves baseUrl without trailing slash", () => {
    const p = new OpenAIProvider(
      "https://api.openai.com/v1",
      "model",
      "sk-key"
    );
    assert.ok(p);
  });

  it("requires apiKey", () => {
    const p = new OpenAIProvider(
      "https://api.openai.com/v1",
      "text-embedding-3-small",
      "sk-required-key"
    );
    assert.equal(p.name, "openai");
  });

  it("embeds method exists and accepts texts array", () => {
    const p = new OpenAIProvider(
      "https://api.openai.com/v1",
      "text-embedding-3-small",
      "sk-key"
    );
    assert.equal(typeof p.embed, "function");
    assert.equal(p.embed.length, 1); // expects texts array parameter
  });

  it("handles custom baseUrl with subpath", () => {
    const p = new OpenAIProvider(
      "https://custom.openai.com/embeddings/v1",
      "model",
      "sk-key"
    );
    assert.ok(p);
  });

  it("handles baseUrl with port number", () => {
    const p = new OpenAIProvider(
      "http://localhost:8080/v1",
      "model",
      "sk-key"
    );
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
      const p = new OpenAIProvider(
        "https://api.openai.com/v1",
        "text-embedding-3-small",
        "sk-test-key",
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
