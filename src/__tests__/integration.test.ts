import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function isOpencodeAvailable(): boolean {
  const result = spawnSync("opencode", ["--version"], { encoding: "utf-8" });
  return result.status === 0;
}

describe("opencode run integration", () => {
  it("starts correctly with the rag plugin and returns relevant files", { skip: !isOpencodeAvailable() ? "opencode binary not found; skipping integration test" : false }, () => {
    const result = spawnSync(
      "opencode",
      ["run", "list relevant files", "--log-level", "ERROR", "--print-logs"],
      {
        encoding: "utf-8",
        timeout: 60_000,
        cwd: process.cwd(),
        shell: true,
      }
    );

    assert.equal(result.status, 0, `opencode exited with code ${result.status}: ${result.stderr}`);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    const lowerStdout = stdout.toLowerCase();
    assert.ok(
      lowerStdout.includes("relevant files") || lowerStdout.includes("opencode-rag retrieved context"),
      `expected plugin context in stdout, got: ${stdout.slice(0, 500)}`
    );

    assert.doesNotMatch(
      stderr,
      /Plugin export is not a function/,
      "stderr should not contain plugin export error"
    );
  });
});
