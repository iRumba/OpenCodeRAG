import type { EmbeddingProvider } from "../core/interfaces.js";
import type { ProxyConfig } from "../core/config.js";
import { postJson } from "./http.js";
import path from "node:path";
import { appendDebugLog } from "../core/fileLogger.js";

export class OllamaProvider implements EmbeddingProvider {
  readonly name = "ollama";

  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;

  constructor(baseUrl: string, model: string, apiKey?: string, timeoutMs: number = 30000, proxy?: ProxyConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.proxy = proxy;
  }

  private getLogFilePath(): string {
    return path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
  }

  private debug(message: string, error?: unknown): void {
    appendDebugLog(this.getLogFilePath(), {
      scope: "embedder.ollama",
      message,
      error,
    });
  }

  async embed(texts: string[], _purpose?: "query" | "document"): Promise<number[][]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    this.debug(`OllamaProvider requesting ${texts.length} embedding vector${texts.length === 1 ? "" : "s"}`);

    try {
      const response = await postJson(
        `${this.baseUrl}/embed`,
        { model: this.model, input: texts.length === 1 ? texts[0] : texts },
        headers,
        this.timeoutMs,
        this.proxy
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama embedding failed (${response.status}): ${body}`);
      }

      const json = (await response.json()) as {
        embedding?: number[];
        embeddings?: number[][];
      };

      if (Array.isArray(json.embeddings) && json.embeddings.every((item) => Array.isArray(item))) {
        this.debug(`OllamaProvider received ${json.embeddings.length} embedding vector${json.embeddings.length === 1 ? "" : "s"}`);
        return json.embeddings;
      }

      if (Array.isArray(json.embedding)) {
        this.debug("OllamaProvider received 1 embedding vector");
        return [json.embedding];
      }

      throw new Error(`Ollama: unexpected response: ${JSON.stringify(json)}`);
    } catch (error) {
      if ((error as Error).name === "AbortError" || (error as Error).message === "Aborted") {
        throw new Error(`Ollama embedding request timed out after ${this.timeoutMs}ms`);
      }

      this.debug("OllamaProvider embedding request failed", error);
      throw error;
    }
  }
}
