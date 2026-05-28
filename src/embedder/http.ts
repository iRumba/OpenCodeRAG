import http from "node:http";
import https from "node:https";

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function directRequest(
  url: URL,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<HttpResponseLike> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload).toString(),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          resolve({
            ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode ?? 0,
            async text() {
              return text;
            },
            async json<T = unknown>() {
              return JSON.parse(text) as T;
            },
          });
        });
      }
    );

    const timeout = setTimeout(() => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    request.on("close", () => {
      clearTimeout(timeout);
    });

    request.end(payload);
  });
}

export async function postJson(
  urlString: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<HttpResponseLike> {
  const url = new URL(urlString);

  if (isLocalhost(url.hostname)) {
    return directRequest(url, body, headers, timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlString, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    return response as HttpResponseLike;
  } catch (err: any) {
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}