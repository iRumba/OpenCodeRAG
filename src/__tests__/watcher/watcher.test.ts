import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_CONFIG, type RagConfig } from "../../core/config.js";
import { LanceDBStore } from "../../vectorstore/lancedb.js";
import type { EmbeddingProvider } from "../../core/interfaces.js";
import { createBackgroundIndexer } from "../../watcher.js";
import { createWatchIgnore } from "../../indexer.js";

class TestEmbedder implements EmbeddingProvider {
  readonly name = "test";

  async embed(texts: string[], _purpose?: "query" | "document"): Promise<number[][]> {
    return texts.map((text, index) => [text.length, index + 1, 0.5, -0.5]);
  }
}

async function makeTempDir(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

function testConfig(): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    indexing: {
      ...DEFAULT_CONFIG.indexing,
      includeExtensions: [".ts"],
      excludeDirs: ["node_modules", ".git", ".opencode", "ignored-dir"],
      minFileSizeBytes: 0,
    },
    openCode: {
      ...DEFAULT_CONFIG.openCode,
      autoIndex: {
        enabled: true,
        debounceMs: 50,
        intervalMs: 100,
      },
    },
  };
}

describe("watcher", () => {
  let workspaceDir: string;
  let storeDir: string;
  let logFilePath: string;
  let store: LanceDBStore;
  const embedder = new TestEmbedder();

  beforeEach(async () => {
    workspaceDir = await makeTempDir("watcher-workspace");
    storeDir = await makeTempDir("watcher-store");
    logFilePath = path.join(workspaceDir, "test.log");
    store = new LanceDBStore(storeDir, 4);
  });

  it("createWatchIgnore returns true for excluded paths and false for source files", () => {
    const config = testConfig();
    const ignore = createWatchIgnore(workspaceDir, config, storeDir);

    // Store dir itself and manifest.json should be ignored
    assert.equal(ignore(storeDir), true);
    assert.equal(ignore(path.join(storeDir, "chunks.lance")), true);
    assert.equal(ignore(path.join(storeDir, "manifest.json")), true);

    // Configured exclude dirs should be ignored
    assert.equal(ignore(path.join(workspaceDir, "node_modules", "some-dep")), true);
    assert.equal(ignore(path.join(workspaceDir, "ignored-dir", "file.ts")), true);

    // Regular source files should NOT be ignored
    assert.equal(ignore(path.join(workspaceDir, "src", "index.ts")), false);
    assert.equal(ignore(path.join(workspaceDir, "index.ts")), false);
  });

  it("createWatchIgnore returns true for files matching .ragignore patterns", () => {
    writeFileSync(path.join(workspaceDir, ".ragignore"), "*.log\n");

    const config = testConfig();
    const ignore = createWatchIgnore(workspaceDir, config, storeDir);

    // .ragignore pattern should exclude .log files
    assert.equal(ignore(path.join(workspaceDir, "src", "debug.log")), true);
    // Non-log files should NOT be ignored
    assert.equal(ignore(path.join(workspaceDir, "src", "index.ts")), false);
  });

  it("can start and gracefully close background indexer", async () => {
    await writeFile(path.join(workspaceDir, "src", "a.ts"), "function alpha() { return 1; }\n");

    const indexer = createBackgroundIndexer({
      cwd: workspaceDir,
      storePath: storeDir,
      config: testConfig(),
      store,
      embedder,
      logFilePath,
    });

    // Let the initial pass start (generous delay under test load)
    await delay(500);

    // Closing it should shut down timers and watchers
    await indexer.close();

    // Check that we index the initial file
    assert.equal(await store.count(), 1);
  });
});
