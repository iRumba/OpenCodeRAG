import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RagConfig } from "./config.js";

export interface RuntimeOverrides {
  retrieval?: {
    topK?: number;
    minScore?: number;
    hybridSearch?: {
      enabled?: boolean;
      keywordWeight?: number;
    };
  };
  openCode?: {
    autoIndex?: {
      enabled?: boolean;
      debounceMs?: number;
    };
    autoInject?: {
      enabled?: boolean;
      minScore?: number;
      maxChunks?: number;
    };
  };
  description?: {
    enabled?: boolean;
  };
}

export function loadRuntimeOverrides(storePath: string): RuntimeOverrides {
  const overridePath = join(storePath, "runtime-overrides.json");
  if (!existsSync(overridePath)) return {};
  try {
    return JSON.parse(readFileSync(overridePath, "utf-8")) as RuntimeOverrides;
  } catch {
    return {};
  }
}

export function saveRuntimeOverride(
  storePath: string,
  path: string[],
  value: boolean | number
): void {
  const overridePath = join(storePath, "runtime-overrides.json");
  const overrides = loadRuntimeOverrides(storePath);

  let target: Record<string, unknown> = overrides as unknown as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!target[key] || typeof target[key] !== "object") {
      target[key] = {};
    }
    target = target[key] as Record<string, unknown>;
  }
  target[path[path.length - 1]!] = value;

  try {
    const dir = dirname(overridePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(overridePath, JSON.stringify(overrides, null, 2), "utf-8");
  } catch {
    // silently ignore write errors
  }
}

export function applyRuntimeOverrides(
  cfg: RagConfig,
  overrides: RuntimeOverrides
): RagConfig {
  if (!overrides || Object.keys(overrides).length === 0) return cfg;

  const merged: RagConfig = JSON.parse(JSON.stringify(cfg));

  if (overrides.retrieval) {
    if (overrides.retrieval.topK !== undefined) merged.retrieval.topK = overrides.retrieval.topK;
    if (overrides.retrieval.minScore !== undefined) merged.retrieval.minScore = overrides.retrieval.minScore;
    if (overrides.retrieval.hybridSearch) {
      if (!merged.retrieval.hybridSearch) merged.retrieval.hybridSearch = { enabled: true, keywordWeight: 0.4 };
      if (overrides.retrieval.hybridSearch.enabled !== undefined) merged.retrieval.hybridSearch.enabled = overrides.retrieval.hybridSearch.enabled;
      if (overrides.retrieval.hybridSearch.keywordWeight !== undefined) merged.retrieval.hybridSearch.keywordWeight = overrides.retrieval.hybridSearch.keywordWeight;
    }
  }

  if (overrides.openCode) {
    if (overrides.openCode.autoIndex) {
      if (!merged.openCode.autoIndex) merged.openCode.autoIndex = { enabled: true, debounceMs: 2000, intervalMs: 300000 };
      if (overrides.openCode.autoIndex.enabled !== undefined) merged.openCode.autoIndex.enabled = overrides.openCode.autoIndex.enabled;
      if (overrides.openCode.autoIndex.debounceMs !== undefined) merged.openCode.autoIndex.debounceMs = overrides.openCode.autoIndex.debounceMs;
    }
    if (overrides.openCode.autoInject) {
      if (!merged.openCode.autoInject) merged.openCode.autoInject = { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 2000 };
      if (overrides.openCode.autoInject.enabled !== undefined) merged.openCode.autoInject.enabled = overrides.openCode.autoInject.enabled;
      if (overrides.openCode.autoInject.minScore !== undefined) merged.openCode.autoInject.minScore = overrides.openCode.autoInject.minScore;
      if (overrides.openCode.autoInject.maxChunks !== undefined) merged.openCode.autoInject.maxChunks = overrides.openCode.autoInject.maxChunks;
    }
  }

  if (overrides.description) {
    if (overrides.description.enabled !== undefined) {
      if (!merged.description) merged.description = { enabled: true, provider: "ollama", baseUrl: "http://127.0.0.1:11434/api", model: "qwen2.5:3b", systemPrompt: "" };
      merged.description.enabled = overrides.description.enabled;
    }
  }

  return merged;
}
