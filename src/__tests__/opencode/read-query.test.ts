import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReadQuery } from "../../opencode/read-query.js";

describe("buildReadQuery", () => {
  it("includes file path in query", () => {
    const result = buildReadQuery({
      filePath: "/project/src/file.ts",
    });
    assert.match(result, /Relevant implementation details in file \/project\/src\/file\.ts/);
    assert.match(result, /Return indexed code chunks with line numbers/);
  });

  it("includes user query when provided", () => {
    const result = buildReadQuery({
      query: "How does incremental indexing work?",
      filePath: "/project/src/indexer.ts",
    });
    assert.match(result, /How does incremental indexing work/);
    assert.match(result, /File: \/project\/src\/indexer\.ts/);
    assert.match(result, /Return relevant indexed code chunks from this file/);
  });

  it("includes line range instruction when both start and end provided", () => {
    const result = buildReadQuery({
      query: "Find the main function",
      filePath: "/project/src/main.ts",
      startLine: 10,
      endLine: 50,
    });
    assert.match(result, /Focus on chunks overlapping lines 10-50/);
  });

  it("includes start-only instruction when only startLine provided", () => {
    const result = buildReadQuery({
      filePath: "/project/src/file.ts",
      startLine: 30,
    });
    assert.match(result, /Focus on chunks at or after line 30/);
  });

  it("includes end-only instruction when only endLine provided", () => {
    const result = buildReadQuery({
      filePath: "/project/src/file.ts",
      endLine: 100,
    });
    assert.match(result, /Focus on chunks at or before line 100/);
  });

  it("handles empty query string gracefully", () => {
    const result = buildReadQuery({
      query: "",
      filePath: "/project/src/file.ts",
    });
    assert.match(result, /Relevant implementation details/);
    assert.doesNotMatch(result, /^$/);
  });

  it("handles whitespace-only query gracefully", () => {
    const result = buildReadQuery({
      query: "   ",
      filePath: "/project/src/file.ts",
    });
    assert.match(result, /Relevant implementation details/);
  });

  it("produces deterministic output for same inputs", () => {
    const a = buildReadQuery({ filePath: "/a.ts", startLine: 1, endLine: 10 });
    const b = buildReadQuery({ filePath: "/a.ts", startLine: 1, endLine: 10 });
    assert.equal(a, b);
  });

  it("produces different output for different inputs", () => {
    const a = buildReadQuery({ filePath: "/a.ts", startLine: 1 });
    const b = buildReadQuery({ filePath: "/b.ts", startLine: 5 });
    assert.notEqual(a, b);
  });
});
