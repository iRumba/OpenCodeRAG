import type { EmbeddingProvider } from "../core/interfaces.js";
import type { RagConfig } from "../core/config.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";

export function createEmbedder(config: RagConfig): EmbeddingProvider {
  const { provider, baseUrl, model, apiKey, proxy, timeoutMs } = config.embedding;
  const effectiveTimeoutMs = timeoutMs ?? 30000;

  switch (provider) {
    case "ollama":
      return new OllamaProvider(baseUrl, model, apiKey, effectiveTimeoutMs, proxy);
    case "openai":
      if (!apiKey) {
        throw new Error("OpenAI provider requires an apiKey");
      }
      return new OpenAIProvider(baseUrl, model, apiKey, effectiveTimeoutMs, proxy);
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

export async function embedBatch(
  embedder: EmbeddingProvider,
  texts: string[],
  batchSize: number = 10,
  purpose?: "query" | "document"
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await embedder.embed(batch, purpose);
    results.push(...embeddings);
  }

  return results;
}
