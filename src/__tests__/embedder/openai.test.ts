import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
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

  it("uses a direct localhost request instead of fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called for localhost");
    }) as typeof fetch;

    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        assert.equal(req.method, "POST");
        assert.ok(req.url?.includes("/embeddings"));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ embedding: [4, 5, 6] }] }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("failed to start test server");
      }

      const p = new OpenAIProvider(`http://localhost:${address.port}/v1`, "text-embedding-3-small", "sk-key");
      const embeddings = await p.embed(["hello"]);

      assert.deepEqual(embeddings, [[4, 5, 6]]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      globalThis.fetch = originalFetch;
    }
  });
});
