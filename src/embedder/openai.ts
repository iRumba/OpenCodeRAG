import type { EmbeddingProvider } from "../core/interfaces.js";
import { postJson } from "./http.js";

export class OpenAIProvider implements EmbeddingProvider {
  readonly name = "openai";

  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(baseUrl: string, model: string, apiKey: string, timeoutMs: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await postJson(
      `${this.baseUrl}/embeddings`,
      { model: this.model, input: texts },
      { Authorization: `Bearer ${this.apiKey}` },
      this.timeoutMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI embedding failed (${response.status}): ${body}`
      );
    }

    const json = (await response.json()) as {
      data: { embedding: number[] }[];
    };

    if (!json.data || !Array.isArray(json.data)) {
      throw new Error(`OpenAI: unexpected response: ${JSON.stringify(json)}`);
    }

    return json.data
      .sort((a, b) => {
        // OpenAI returns data in correct order but with index field
        return 0;
      })
      .map((item) => item.embedding);
  }
}
