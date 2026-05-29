import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { normalizeReadArgs, resolveWorkspacePath } from "../../opencode/tool-args.js";

function resolve(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

describe("normalizeReadArgs", () => {
  it("accepts filePath", () => {
    const result = normalizeReadArgs({ filePath: "src/plugin.ts" });
    assert.equal(result.filePath, "src/plugin.ts");
    assert.equal(result.startLine, undefined);
    assert.equal(result.endLine, undefined);
    assert.equal(result.query, undefined);
  });

  it("accepts path as alias", () => {
    const result = normalizeReadArgs({ path: "src/index.ts" });
    assert.equal(result.filePath, "src/index.ts");
  });

  it("accepts absolutePath as alias", () => {
    const result = normalizeReadArgs({ absolutePath: "/home/user/src/index.ts" });
    assert.equal(result.filePath, "/home/user/src/index.ts");
  });

  it("prefers filePath over path and absolutePath", () => {
    const result = normalizeReadArgs({
      filePath: "src/a.ts",
      path: "src/b.ts",
      absolutePath: "src/c.ts",
    });
    assert.equal(result.filePath, "src/a.ts");
  });

  it("prefers path over absolutePath when no filePath", () => {
    const result = normalizeReadArgs({
      path: "src/b.ts",
      absolutePath: "src/c.ts",
    });
    assert.equal(result.filePath, "src/b.ts");
  });

  it("converts offset + limit to startLine + endLine", () => {
    const result = normalizeReadArgs({ filePath: "test.ts", offset: 10, limit: 5 });
    assert.equal(result.startLine, 10);
    assert.equal(result.endLine, 14);
  });

  it("passes through startLine + endLine", () => {
    const result = normalizeReadArgs({ filePath: "test.ts", startLine: 5, endLine: 20 });
    assert.equal(result.startLine, 5);
    assert.equal(result.endLine, 20);
  });

  it("prefers explicit startLine over offset", () => {
    const result = normalizeReadArgs({
      filePath: "test.ts",
      startLine: 5,
      offset: 10,
    });
    assert.equal(result.startLine, 5);
  });

  it("prefers explicit endLine over offset+limit", () => {
    const result = normalizeReadArgs({
      filePath: "test.ts",
      endLine: 30,
      offset: 10,
      limit: 5,
    });
    assert.equal(result.endLine, 30);
  });

  it("accepts query as alias for user intent", () => {
    const result = normalizeReadArgs({
      filePath: "test.ts",
      query: "How does X work?",
    });
    assert.equal(result.query, "How does X work?");
  });

  it("accepts reason as alias for user intent", () => {
    const result = normalizeReadArgs({
      filePath: "test.ts",
      reason: "Need to understand Y",
    });
    assert.equal(result.query, "Need to understand Y");
  });

  it("prefers query over reason", () => {
    const result = normalizeReadArgs({
      filePath: "test.ts",
      query: "Query value",
      reason: "Reason value",
    });
    assert.equal(result.query, "Query value");
  });

  it("throws when no file path is provided", () => {
    assert.throws(
      () => normalizeReadArgs({}),
      /read requires filePath, path, or absolutePath/
    );
  });

  it("throws when startLine < 1", () => {
    assert.throws(
      () => normalizeReadArgs({ filePath: "test.ts", startLine: 0 }),
      /startLine\/offset must be >= 1/
    );
  });

  it("throws when offset < 1", () => {
    assert.throws(
      () => normalizeReadArgs({ filePath: "test.ts", offset: 0 }),
      /startLine\/offset must be >= 1/
    );
  });

  it("throws when endLine < 1", () => {
    assert.throws(
      () => normalizeReadArgs({ filePath: "test.ts", endLine: 0 }),
      /endLine must be >= 1/
    );
  });

  it("throws when endLine < startLine", () => {
    assert.throws(
      () => normalizeReadArgs({ filePath: "test.ts", startLine: 20, endLine: 10 }),
      /endLine must be greater than or equal to startLine/
    );
  });
});

describe("resolveWorkspacePath", () => {
  const worktree = resolve("/project");

  it("resolves relative path against worktree", () => {
    const result = resolveWorkspacePath(worktree, "src/file.ts");
    assert.equal(result, worktree + "/src/file.ts");
  });

  it("normalizes absolute path", () => {
    const absPath = worktree + "/src/file.ts";
    const result = resolveWorkspacePath(worktree, absPath);
    assert.equal(result, absPath);
  });

  it("accepts path inside worktree", () => {
    const absPath = worktree + "/subdir/file.ts";
    const result = resolveWorkspacePath(worktree, absPath);
    assert.equal(result, absPath);
  });

  it("rejects path outside worktree", () => {
    const outside = resolve("/other") + "/file.ts";
    assert.throws(
      () => resolveWorkspacePath(worktree, outside),
      /outside the workspace/
    );
  });

  it("uses forward slashes on output", () => {
    const result = resolveWorkspacePath(worktree, "src\\file.ts");
    assert.equal(result, worktree + "/src/file.ts");
  });

  it("handles parent directory traversal within workspace", () => {
    const result = resolveWorkspacePath(worktree, "subdir/../src/file.ts");
    assert.equal(result, worktree + "/src/file.ts");
  });

  it("rejects parent directory traversal outside workspace", () => {
    assert.throws(
      () => resolveWorkspacePath(worktree, "../../other/file.ts"),
      /outside the workspace/
    );
  });
});
