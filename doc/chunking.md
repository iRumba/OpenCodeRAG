# Chunking

OpenCodeRAG uses **tree-sitter** (AST-based) parsing for programming languages, regex-based splitting for structured documents, and line-based fallback for everything else.

## Supported Languages & Formats

### AST-Based (tree-sitter) — 17 Languages

| Language | Chunker | Extensions |
|---|---|---|
| TypeScript | `typescript.ts` | `.ts`, `.tsx` |
| JavaScript | `javascript.ts` | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `python.ts` | `.py` |
| Java | `java.ts` | `.java` |
| Go | `go.ts` | `.go` |
| C | `c.ts` | `.c`, `.h` |
| C++ | `cpp.ts` | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` |
| C# | `csharp.ts` | `.cs` |
| Rust | `rust.ts` | `.rs` |
| Ruby | `ruby.ts` | `.rb` |
| Kotlin | `kotlin.ts` | `.kt`, `.kts` |
| Swift | `swift.ts` | `.swift` |
| JSON | `json.ts` | `.json` |
| HTML | `html.ts` | `.html`, `.htm` |
| CSS | `css.ts` | `.css` |
| XML | `xml.ts` | `.xml` |
| Razor | `razor.ts` | `.razor`, `.cshtml` |

### Regex / Structure-Based

| Format | Chunker | Extensions | Strategy |
|---|---|---|---|
| Markdown | `markdown.ts` | `.md`, `.mdx` | Heading-splitter, code-block aware |
| LaTeX | `tex.ts` | `.tex` | Section-splitter (chapter/section/subsection), comment-aware |
| Solution | `sln.ts` | `.sln` | Project-section based |

### Document Text Extraction

| Format | Chunker | Extensions | Backend |
|---|---|---|---|
| PDF | `pdf.ts` | `.pdf` | `pdfjs-dist` + DOMMatrix polyfill |
| DOCX | `docx.ts` | `.docx` | `mammoth` |
| DOC | `doc.ts` | `.doc` | `word-extractor` |
| Excel | `excel.ts` | `.xls`, `.xlsx` | `@e965/xlsx` |

### Fallback

| Language | Chunker | Strategy |
|---|---|---|
| All others | `fallback.ts` | 100-line raw text blocks |

## How Chunkers Work

### TreeSitterChunker (Abstract Base)
Defined in `src/chunker/base.ts`. Each AST-based chunker:

1. Loads the tree-sitter grammar via `loadGrammar()` (WASM bundled in `tree-sitter-wasm`)
2. Parses the file content into a CST (Concrete Syntax Tree)
3. Walks top-level declarations (functions, classes, methods, interfaces, etc.)
4. Produces a `Chunk` per declaration with accurate line ranges

Key parameters in `TreeSitterChunker`:

```typescript
abstract class TreeSitterChunker {
  abstract language: string;
  abstract fileExtensions: string[];
  abstract grammarName: string;     // tree-sitter grammar name
  abstract nodeTypes: string[];     // AST node types to chunk on
  // ...
}
```

### Regex Chunkers
Markdown splits on `#` headings, respecting code-fence boundaries. LaTeX splits on `\chapter`, `\section`, `\subsection`, skipping comments.

### Document Chunkers
Binary formats are extracted to text first (via dedicated libraries), then split into paragraph-based chunks. Small paragraphs are grouped; oversized chunks are split further.

### Fallback Chunker
Simply splits text into 100-line blocks. Used for any extension not handled by a specialized chunker.

## Adding a New Language Chunker

1. Create `src/chunker/<lang>.ts` extending `TreeSitterChunker`
2. Set `language`, `fileExtensions`, `grammarName`, `nodeTypes`
3. Add the new chunker instance to the `chunkers` array in `factory.ts`
4. Verify the grammar exists in `tree-sitter-wasm` (`node_modules/tree-sitter-wasm/README.md`)
5. Add the extension to `DEFAULT_CONFIG.indexing.includeExtensions`

## Adding a Non-Code Chunker (e.g., PDF)

1. Create `src/chunker/<format>.ts` implementing `Chunker` directly (not `TreeSitterChunker`)
2. Use dynamic imports for heavy dependencies to avoid startup overhead
3. Register in `factory.ts`
4. Update `scanWorkspace` in `indexer.ts` to read binary files as `Buffer`

## Custom Chunkers via Config

You can inject custom chunkers without modifying source code via `opencode-rag.json`:

```json
{
  "chunkers": [
    { "module": "./path/to/my-chunker.js", "extensions": [".xyz"] }
  ]
}
```

The module must export a class implementing the `Chunker` interface.
