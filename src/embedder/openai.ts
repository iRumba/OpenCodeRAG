import type { EmbeddingProvider } from "../core/interfaces.js";
import type { ProxyConfig } from "../core/config.js";
import { postJson } from "./http.js";

export class OpenAIProvider implements EmbeddingProvider {
  readonly name = "openai";

  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;

  constructor(baseUrl: string, model: string, apiKey: string, timeoutMs: number = 30000, proxy?: ProxyConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.proxy = proxy;
  }

  async embed(texts: string[], purpose?: "query" | "document"): Promise<number[][]> {
    const body: Record<string, unknown> = { model: this.model, input: texts };
    if (purpose) {
      body.input_type = purpose;
    }
    const response = await postJson(
      `${this.baseUrl}/embeddings`,
      body,
      { Authorization: `Bearer ${this.apiKey}` },
      this.timeoutMs,
      this.proxy
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
        return 0;
      })
      .map((item) => item.embedding);
  }
}
