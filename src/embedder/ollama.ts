import type { EmbeddingProvider } from "../core/interfaces.js";
import type { ProxyConfig } from "../core/config.js";
import path from "node:path";
import { appendDebugLog } from "../core/fileLogger.js";

// OllamaProvider in this branch is configured to operate in a text-only mode
// — it returns the original input texts instead of numeric vectors. This
// satisfies the user's request to "Don't return the vectors from ollama,
// only the text chunks". Consumers must detect and handle `string[][]`.
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

  // Return the original texts (one per input) as a `string[][]` where each
  // inner array contains the full text. This intentionally does not call the
  // Ollama embedding endpoint and does not return numeric vectors.
  async embed(texts: string[]): Promise<number[][] | string[][]> {
    this.debug(`OllamaProvider (text-only) returning ${texts.length} text chunks`);
    return texts.map((t) => [t]);
  }
}
