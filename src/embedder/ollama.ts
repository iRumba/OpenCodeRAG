import type { EmbeddingProvider } from "../core/interfaces.js";
import { postJson } from "./http.js";

export class OllamaProvider implements EmbeddingProvider {
  readonly name = "ollama";

  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(baseUrl: string, model: string, apiKey?: string, timeoutMs: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const response = await postJson(
        `${this.baseUrl}/embeddings`,
        { model: this.model, prompt: text },
        this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        this.timeoutMs
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Ollama embedding failed (${response.status}): ${body}`
        );
      }

      const json = (await response.json()) as { embedding: number[] };
      if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error(`Ollama: unexpected response: ${JSON.stringify(json)}`);
      }
      results.push(json.embedding);
    }

    return results;
  }
}
