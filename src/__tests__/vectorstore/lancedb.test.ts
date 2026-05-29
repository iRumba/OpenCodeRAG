import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LanceDBStore } from "../../vectorstore/lancedb.js";
import { normalizeFilePath } from "../../core/manifest.js";

describe("LanceDBStore (memory)", () => {
  let store: LanceDBStore;

  before(async () => {
    store = new LanceDBStore("memory://");
  });

  after(async () => {
    await store.clear();
  });

  it("starts with zero count", async () => {
    const count = await store.count();
    assert.equal(count, 0);
  });

  it("adds chunks and returns correct count", async () => {
    const chunks = [
      {
        id: "chunk-1",
        content: "function hello() { return 'world'; }",
        embedding: new Array(384).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1)),
        metadata: {
          filePath: "src/hello.ts",
          startLine: 1,
          endLine: 5,
          language: "typescript",
        },
      },
      {
        id: "chunk-2",
        content: "function goodbye() { return 'farewell'; }",
        embedding: new Array(384).fill(0).map((_, i) => (i % 2 === 0 ? -0.1 : 0.1)),
        metadata: {
          filePath: "src/goodbye.ts",
          startLine: 1,
          endLine: 5,
          language: "typescript",
        },
      },
    ];

    await store.addChunks(chunks);
    const count = await store.count();
    assert.equal(count, 2);
  });

  it("searches and returns results with scores", async () => {
    // Search with a vector similar to chunk-1
    const queryVector = new Array(384).fill(0).map((_, i) =>
      i % 2 === 0 ? 0.1 : -0.1
    );

    const results = await store.search(queryVector, 2);
    assert.ok(results.length > 0, "Should return at least one result");
    assert.ok(results[0]!.score > 0, "Score should be positive");
    assert.ok(results[0]!.score <= 1, "Score should be <= 1");
    assert.equal(typeof results[0]!.chunk.id, "string");
    assert.equal(typeof results[0]!.chunk.content, "string");
  });

  it("respects topK parameter", async () => {
    const queryVector = new Array(384).fill(0.1);
    const results = await store.search(queryVector, 1);
    assert.equal(results.length, 1);
  });

  it("clears all chunks", async () => {
    await store.clear();
    const count = await store.count();
    assert.equal(count, 0);
  });

  it("can re-add chunks after clear", async () => {
    const chunks = [
      {
        id: "chunk-3",
        content: "new content",
        embedding: new Array(384).fill(0.05),
        metadata: {
          filePath: "src/new.ts",
          startLine: 1,
          endLine: 3,
          language: "typescript",
        },
      },
    ];

    await store.addChunks(chunks);
    const count = await store.count();
    assert.equal(count, 1);
  });

  it("filters out chunks without embeddings in addChunks", async () => {
    await store.clear();

    const chunks = [
      {
        id: "no-embed",
        content: "no embedding",
        embedding: undefined as unknown as number[],
        metadata: {
          filePath: "test.ts",
          startLine: 1,
          endLine: 1,
          language: "typescript",
        },
      },
      {
        id: "empty-embed",
        content: "empty embedding",
        embedding: [],
        metadata: {
          filePath: "test.ts",
          startLine: 2,
          endLine: 2,
          language: "typescript",
        },
      },
    ];

    await store.addChunks(chunks);
    const count = await store.count();
    assert.equal(count, 0, "Chunks without embeddings should not be stored");
  });

  it("deletes all chunks for a specific file path", async () => {
    await store.clear();

    await store.addChunks([
      {
        id: "delete-1",
        content: "alpha",
        embedding: new Array(384).fill(0.1),
        metadata: {
          filePath: "src/delete-me.ts",
          startLine: 1,
          endLine: 1,
          language: "typescript",
        },
      },
      {
        id: "delete-2",
        content: "beta",
        embedding: new Array(384).fill(0.2),
        metadata: {
          filePath: "src/keep-me.ts",
          startLine: 1,
          endLine: 1,
          language: "typescript",
        },
      },
      {
        id: "delete-3",
        content: "gamma",
        embedding: new Array(384).fill(0.3),
        metadata: {
          filePath: "src/delete-me.ts",
          startLine: 2,
          endLine: 2,
          language: "typescript",
        },
      },
    ]);

    await store.deleteByFilePath("src/delete-me.ts");

    const count = await store.count();
    assert.equal(count, 1);

    const results = await store.search(new Array(384).fill(0.2), 5);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.chunk.metadata.filePath, normalizeFilePath("src/keep-me.ts"));
  });
});

describe("LanceDBStore (disk corruption recovery)", () => {
  it("recovers gracefully from missing data files", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "opencode-rag-test-"));
    try {
      const store = new LanceDBStore(tmpDir);

      const emb1 = new Array(384).fill(0.1);
      const emb2 = new Array(384).fill(0.2);

      await store.addChunks([
        { id: "r1", content: "alpha", embedding: emb1, metadata: { filePath: "a.ts", startLine: 1, endLine: 1, language: "ts" } },
      ]);
      await store.addChunks([
        { id: "r2", content: "beta", embedding: emb2, metadata: { filePath: "b.ts", startLine: 1, endLine: 1, language: "ts" } },
      ]);

      const countBefore = await store.count();
      assert.ok(countBefore > 0, "should have data before corruption");

      const dataDir = join(tmpDir, "chunks.lance", "data");
      if (existsSync(dataDir)) {
        for (const f of readdirSync(dataDir)) {
          if (f.endsWith(".lance")) {
            unlinkSync(join(dataDir, f));
          }
        }
      }

      const results = await store.search(emb1, 10);
      assert.ok(Array.isArray(results), "should return an array without throwing");

      const finalCount = await store.count();
      assert.equal(typeof finalCount, "number", "count should return a number without throwing");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles non-existent table gracefully", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "opencode-rag-test-"));
    try {
      const store = new LanceDBStore(tmpDir);
      const results = await store.search(new Array(384).fill(0.1), 10);
      assert.equal(results.length, 0);
      const count = await store.count();
      assert.equal(count, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
