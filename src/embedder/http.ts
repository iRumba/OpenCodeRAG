import net from "node:net";
import tls from "node:tls";
import type { ProxyConfig } from "../core/config.js";

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function parseNoProxyList(noProxy?: string): string[] {
  if (!noProxy) return [];
  return noProxy
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function matchesNoProxy(hostname: string, noProxy?: string): boolean {
  const normalized = hostname.toLowerCase();
  const patterns = parseNoProxyList(noProxy);

  if (isLocalhost(normalized)) return true;

  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern.startsWith(".") && normalized.endsWith(pattern)) return true;
    if (pattern.startsWith(".") && normalized === pattern.slice(1)) return true;
    if (normalized === pattern) return true;
  }

  return false;
}

function buildProxyAuthHeader(proxy?: ProxyConfig): string | undefined {
  if (proxy?.username && proxy?.password) {
    const encoded = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
    return `Basic ${encoded}`;
  }
  return undefined;
}

function applyProxyEnv(proxy?: ProxyConfig): { httpProxy: string; httpsProxy: string } | null {
  if (!proxy?.url) return null;

  const existingHttp = process.env.HTTP_PROXY || process.env.http_proxy;
  const existingHttps = process.env.HTTPS_PROXY || process.env.https_proxy;

  if (existingHttp && existingHttps) return null;

  return {
    httpProxy: existingHttp || proxy.url,
    httpsProxy: existingHttps || proxy.url,
  };
}

export function directRequest(
  url: URL,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  redirectCount: number = 0
): Promise<HttpResponseLike> {
  return sendRawHttpRequest(url, body, headers, timeoutMs, redirectCount);
}

const CRLF = Buffer.from("\r\n");

function buildRequestPayload(body: unknown, headers: Record<string, string>, url: URL): Buffer {
  const payload = JSON.stringify(body);
  const requestHeaders: Record<string, string> = {
    Host: url.host,
    Connection: "close",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload).toString(),
    ...headers,
  };

  const headerLines = Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`);
  const requestText = [
    `POST ${url.pathname}${url.search} HTTP/1.1`,
    ...headerLines,
    "",
    payload,
  ].join("\r\n");

  return Buffer.from(requestText, "utf8");
}

function parseHeaderLines(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = headerText.split("\r\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
  }

  return headers;
}

function decodeChunkedBody(body: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < body.length) {
    const sizeLineEnd = body.indexOf(CRLF, offset);
    if (sizeLineEnd < 0) break;

    const sizeLine = body.slice(offset, sizeLineEnd).toString("ascii").split(";", 1)[0]?.trim() ?? "0";
    const size = Number.parseInt(sizeLine, 16);
    offset = sizeLineEnd + CRLF.length;

    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Invalid chunk size: ${sizeLine}`);
    }

    if (size === 0) {
      break;
    }

    const chunkEnd = offset + size;
    if (chunkEnd > body.length) {
      throw new Error("Incomplete chunked HTTP response");
    }

    chunks.push(body.slice(offset, chunkEnd));
    offset = chunkEnd + CRLF.length;
  }

  return Buffer.concat(chunks);
}

function parseResponse(buffer: Buffer): { status: number; headers: Record<string, string>; body: Buffer } {
  const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
  if (headerEnd < 0) {
    throw new Error("Invalid HTTP response: missing header terminator");
  }

  const headerText = buffer.slice(0, headerEnd).toString("utf8");
  const body = buffer.slice(headerEnd + 4);
  const statusLine = headerText.split("\r\n")[0] ?? "";
  const statusMatch = /^HTTP\/\d+\.\d+\s+(\d+)/.exec(statusLine);
  if (!statusMatch) {
    throw new Error(`Invalid HTTP response status line: ${statusLine}`);
  }

  const headers = parseHeaderLines(headerText);
  const status = Number.parseInt(statusMatch[1] ?? "0", 10);

  if (headers["transfer-encoding"]?.toLowerCase().includes("chunked")) {
    return { status, headers, body: decodeChunkedBody(body) };
  }

  const contentLength = Number.parseInt(headers["content-length"] ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength >= 0) {
    return { status, headers, body: body.slice(0, contentLength) };
  }

  return { status, headers, body };
}

async function sendRawHttpRequest(
  url: URL,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  redirectCount: number
): Promise<HttpResponseLike> {
  const payload = JSON.stringify(body);
  const requestBuffer = buildRequestPayload(body, headers, url);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const isHttps = url.protocol === "https:";

  const responseBuffer = await new Promise<Buffer>((resolve, reject) => {
    const socket = isHttps
      ? tls.connect({ host: url.hostname, port, servername: url.hostname })
      : net.connect({ host: url.hostname, port });

    const chunks: Buffer[] = [];
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      settle(() => {
        socket.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(requestBuffer);
    });

    socket.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    socket.on("end", () => {
      const buffer = Buffer.concat(chunks);
      settle(() => resolve(buffer));
    });

    socket.on("error", (err) => {
      settle(() => reject(err));
    });
  });

  const response = parseResponse(responseBuffer);
  const location = response.headers.location;

  if (
    response.status >= 300 &&
    response.status < 400 &&
    typeof location === "string" &&
    location.length > 0
  ) {
    if (redirectCount >= 5) {
      const text = `Redirect limit exceeded for ${url.toString()}`;
      return {
        ok: false,
        status: response.status,
        async text() {
          return text;
        },
        async json<T = unknown>() {
          return JSON.parse(`{"error":"Redirect limit exceeded"}`) as T;
        },
      };
    }

    return sendRawHttpRequest(new URL(location, url), body, headers, timeoutMs, redirectCount + 1);
  }

  const text = response.body.toString("utf8");
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    async text() {
      return text;
    },
    async json<T = unknown>() {
      return JSON.parse(text) as T;
    },
  };
}

export async function postJson(
  urlString: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  proxy?: ProxyConfig
): Promise<HttpResponseLike> {
  const url = new URL(urlString);

  const bypassProxy = isLocalhost(url.hostname) || matchesNoProxy(url.hostname, proxy?.noProxy);

  if (bypassProxy || !proxy?.url) {
    return directRequest(url, body, headers, timeoutMs);
  }

  return postJsonViaFetch(urlString, body, headers, timeoutMs, proxy);
}

async function postJsonViaFetch(
  urlString: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  proxy: ProxyConfig
): Promise<HttpResponseLike> {
  const authHeader = buildProxyAuthHeader(proxy);
  const envOverride = applyProxyEnv(proxy);

  const savedHttpProxy = process.env.HTTP_PROXY;
  const savedHttpsProxy = process.env.HTTPS_PROXY;

  try {
    if (envOverride) {
      process.env.HTTP_PROXY = envOverride.httpProxy;
      process.env.HTTPS_PROXY = envOverride.httpsProxy;
    }

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };

    if (authHeader) {
      requestHeaders["Proxy-Authorization"] = authHeader;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(urlString, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      return response as unknown as HttpResponseLike;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (envOverride) {
      process.env.HTTP_PROXY = savedHttpProxy;
      process.env.HTTPS_PROXY = savedHttpsProxy;
    }
  }
}
