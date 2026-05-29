import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const MAX_CHUNK_CHARS = 4000;
const MIN_GROUP_CHARS = 300;

const PARAGRAPH_SPLIT = /\n\s*\n/;

async function createPdfDocument(buffer: Buffer) {
  const { DOMMatrix } = await import("canvas");
  globalThis.DOMMatrix ??= DOMMatrix as unknown as typeof globalThis.DOMMatrix;
  globalThis.DOMMatrixReadOnly ??= DOMMatrix as unknown as typeof globalThis.DOMMatrixReadOnly;

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  return loadingTask.promise;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await createPdfDocument(buffer);
  const texts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const textItems = content.items.filter(
      (item) => typeof item === "object" && item !== null && "str" in item
    ) as { str: string }[];
    const strings = textItems.map((item) => item.str);
    texts.push(strings.join(" "));
  }

  return texts.join("\n\n");
}

export class PdfChunker implements Chunker {
  readonly language = "pdf";
  readonly fileExtensions = [".pdf"];

  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const paragraphs = content.split(PARAGRAPH_SPLIT).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) return [];

    const chunks: Chunk[] = [];
    let currentGroup: string[] = [];
    let currentSize = 0;
    let paragraphIndex = 0;

    function flush() {
      const text = currentGroup.join("\n\n").trim();
      if (text.length === 0) return;
      chunks.push({
        id: uuid(),
        content: text,
        metadata: {
          filePath,
          startLine: paragraphIndex - currentGroup.length + 1,
          endLine: paragraphIndex,
          language: "pdf",
        },
      });
      currentGroup = [];
      currentSize = 0;
    }

    for (const para of paragraphs) {
      paragraphIndex++;
      const paraLen = para.length;

      if (paraLen > MAX_CHUNK_CHARS) {
        if (currentGroup.length > 0) flush();
        chunks.push({
          id: uuid(),
          content: para,
          metadata: {
            filePath,
            startLine: paragraphIndex,
            endLine: paragraphIndex,
            language: "pdf",
          },
        });
        continue;
      }

      if (currentGroup.length > 0 && currentSize + paraLen > MAX_CHUNK_CHARS) {
        flush();
      }

      currentGroup.push(para);
      currentSize += paraLen;

      if (currentSize >= MIN_GROUP_CHARS && currentGroup.length >= 1) {
        const nextParaStillSmall =
          paragraphIndex < paragraphs.length &&
          paragraphs[paragraphIndex]!.length < MIN_GROUP_CHARS;
        if (!nextParaStillSmall) {
          flush();
        }
      }
    }

    if (currentGroup.length > 0) {
      flush();
    }

    return chunks;
  }
}

export const pdfChunker = new PdfChunker();
