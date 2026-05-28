import type { EmbeddingProvider } from "../core/interfaces.js";

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
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
        throw new Error(`OpenAI embedding timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(id);
    }

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
