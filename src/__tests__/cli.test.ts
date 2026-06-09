import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const originalCwd = process.cwd;

describe("opencode-rag init", () => {
  let tmpDir: string;
  let symlinkPath: string;

  before(() => {
    tmpDir = join(tmpdir(), `opencode-rag-init-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    symlinkPath = join(tmpDir, "opencode-rag-cli-symlink.js");
  });

  after(() => {
    try {
      rmSync(symlinkPath, { force: true });
    } catch {
      // ignore cleanup failures
    }
    process.cwd = originalCwd;
  });

  it("creates opencode-rag.json and .opencode/.gitignore and .opencode/ dir", async () => {
    process.cwd = () => tmpDir;

    // Dynamic import so commander registers the 'init' command
    const { runCli } = await import("../cli.js");
    await runCli(["node", "cli.ts", "init", "--skip-install"]);

    const configPath = join(tmpDir, "opencode-rag.json");
    const opencodeDir = join(tmpDir, ".opencode");
    const gitignorePath = join(opencodeDir, ".gitignore");
    const opencodeConfigPath = join(opencodeDir, "opencode.json");
    const opencodePackagePath = join(opencodeDir, "package.json");
    const pluginEntryPath = join(opencodeDir, "plugins", "rag-plugin.js");

    assert.ok(existsSync(opencodeDir), ".opencode/ should exist");
    assert.ok(existsSync(gitignorePath), ".opencode/.gitignore should exist");
    assert.ok(existsSync(opencodeConfigPath), ".opencode/opencode.json should exist");
    assert.ok(existsSync(opencodePackagePath), ".opencode/package.json should exist");
    assert.ok(existsSync(pluginEntryPath), ".opencode/plugins/rag-plugin.js should exist");
    assert.ok(existsSync(configPath), "opencode-rag.json should exist");

    // Check opencode-rag.json is valid JSON
    const configContent = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(configContent);
    assert.equal(parsed.embedding.provider, "ollama");
    assert.equal(parsed.embedding.baseUrl, "http://localhost:11434/api");
    assert.equal(parsed.vectorStore.path, "./.opencode/rag_db");

    // Check .gitignore content
    const gitignoreContent = readFileSync(gitignorePath, "utf-8");
    assert.ok(gitignoreContent.includes("node_modules/"));
    assert.ok(gitignoreContent.includes("package-lock.json"));
    assert.ok(gitignoreContent.includes("rag_db/"));
    assert.ok(gitignoreContent.includes("opencode-rag.log"));

    const opencodeConfig = JSON.parse(readFileSync(opencodeConfigPath, "utf-8"));
    assert.equal(opencodeConfig.$schema, "https://opencode.ai/config.json");

    const opencodePackage = JSON.parse(readFileSync(opencodePackagePath, "utf-8"));
    assert.equal(opencodePackage.type, "module");
    assert.equal(opencodePackage.private, true);
    assert.equal(opencodePackage.dependencies["@opencode-ai/plugin"], "1.15.5");
    assert.match(opencodePackage.dependencies["opencode-rag-plugin"], /^file:/);

    const pluginEntry = readFileSync(pluginEntryPath, "utf-8");
    assert.match(pluginEntry, /node_modules\/opencode-rag-plugin\/dist\/plugin-entry\.js/);
  });

  it("does not overwrite existing files without --force", async () => {
    process.cwd = () => tmpDir;

    // Replace opencode-rag.json with custom content
    const configPath = join(tmpDir, "opencode-rag.json");
    const customContent = JSON.stringify({ embedding: { provider: "openai" } });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(configPath, customContent, "utf-8");

    // Re-run init without force
    const { runCli } = await import("../cli.js");
    await runCli(["node", "cli.ts", "init", "--skip-install"]);

    // Content should be unchanged (still our custom content)
    const afterContent = readFileSync(configPath, "utf-8");
    assert.equal(afterContent, customContent, "should not overwrite without --force");
  });

  it("overwrites files with --force", async () => {
    process.cwd = () => tmpDir;

    const configPath = join(tmpDir, "opencode-rag.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(configPath, "garbage", "utf-8");

    const { runCli } = await import("../cli.js");
    await runCli(["node", "cli.ts", "init", "--force", "--skip-install"]);

    const afterContent = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(afterContent);
    assert.equal(parsed.embedding.provider, "ollama", "should contain defaults after force");
  });

  it("resolves symlinked cli entrypoints", async () => {
    // Skip on Windows due to symlink permission requirements
    if (process.platform === "win32") {
      return;
    }
    const cliModuleFileUrl = new URL("../cli.ts", import.meta.url);
    const cliModuleUrl = cliModuleFileUrl.href;
    symlinkSync(fileURLToPath(cliModuleFileUrl), symlinkPath);
    assert.ok(existsSync(symlinkPath));

    const { shouldAutoRunCli } = await import("../cli.js");

    assert.equal(shouldAutoRunCli(cliModuleUrl, symlinkPath), true);
    assert.equal(shouldAutoRunCli(cliModuleUrl, join(tmpDir, "missing-cli.js")), false);
    assert.equal(shouldAutoRunCli(cliModuleUrl, undefined), false);
  });
});
