import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ignore from 'ignore';
import {
  RAGIGNORE_FILENAME,
  loadRagignoreFileSync,
  loadRagignoreFile,
  loadRagignoreFromDir,
  extendIgnoreFilter,
  collectRagignorePatterns,
  buildFilterForPath,
} from '../ragignore.js';
import { walkFiles } from '../indexer.js';

describe('ragignore', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // loadRagignoreFileSync
  // ---------------------------------------------------------------------------
  describe('loadRagignoreFileSync', () => {
    it('returns content when file exists', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const filePath = path.join(tmpDir, '.ragignore');
      writeFileSync(filePath, 'node_modules/\n*.log\n', 'utf-8');

      const result = loadRagignoreFileSync(filePath);

      assert.equal(result, 'node_modules/\n*.log\n');
    });

    it('returns null when file does not exist', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const filePath = path.join(tmpDir, 'nonexistent.ragignore');

      const result = loadRagignoreFileSync(filePath);

      assert.equal(result, null);
    });

    it('returns null when file cannot be read (path is a directory)', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));

      const result = loadRagignoreFileSync(tmpDir);

      assert.equal(result, null);
    });

    it('returns empty string when file is empty', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const filePath = path.join(tmpDir, '.ragignore');
      writeFileSync(filePath, '');

      const result = loadRagignoreFileSync(filePath);

      assert.equal(result, '');
    });
  });

  // ---------------------------------------------------------------------------
  // loadRagignoreFile (async)
  // ---------------------------------------------------------------------------
  describe('loadRagignoreFile', () => {
    it('returns content when file exists', async () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const filePath = path.join(tmpDir, '.ragignore');
      writeFileSync(filePath, 'dist/\nbuild/\n', 'utf-8');

      const result = await loadRagignoreFile(filePath);

      assert.equal(result, 'dist/\nbuild/\n');
    });

    it('returns null when file does not exist', async () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const filePath = path.join(tmpDir, 'nonexistent.ragignore');

      const result = await loadRagignoreFile(filePath);

      assert.equal(result, null);
    });

    it('returns null when path is a directory (async)', async () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));

      const result = await loadRagignoreFile(tmpDir);

      assert.equal(result, null);
    });
  });

  // ---------------------------------------------------------------------------
  // loadRagignoreFromDir
  // ---------------------------------------------------------------------------
  describe('loadRagignoreFromDir', () => {
    it('returns content when .ragignore exists in dir', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), '*.log\n', 'utf-8');

      const result = loadRagignoreFromDir(tmpDir);

      assert.equal(result, '*.log\n');
    });

    it('returns null when .ragignore does not exist', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));

      const result = loadRagignoreFromDir(tmpDir);

      assert.equal(result, null);
    });

    it('returns null when .ragignore is empty', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), '', 'utf-8');

      const result = loadRagignoreFromDir(tmpDir);

      assert.equal(result, null);
    });

    it('returns null when .ragignore is whitespace-only', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), '  \n  \t  \n', 'utf-8');

      const result = loadRagignoreFromDir(tmpDir);

      assert.equal(result, null);
    });
  });

  // ---------------------------------------------------------------------------
  // extendIgnoreFilter
  // ---------------------------------------------------------------------------
  describe('extendIgnoreFilter', () => {
    it('returns parentFilter when no .ragignore in dir', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const parent = ignore().add('*.log');

      const result = extendIgnoreFilter(tmpDir, parent);

      assert.equal(result, parent);
    });

    it('returns new Ignore instance with parent patterns + new when .ragignore exists', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), 'build/\n', 'utf-8');
      const parent = ignore().add('*.log');

      const result = extendIgnoreFilter(tmpDir, parent);

      assert.notEqual(result, parent);
      assert.ok(result);
      // Combined filter should ignore both patterns
      assert.equal(result!.ignores('test.log'), true);
      assert.equal(result!.ignores('build/main.js'), true);
      // Should not ignore unrelated files
      assert.equal(result!.ignores('README.md'), false);
    });

    it('returns new Ignore instance without parent when parentFilter is undefined and .ragignore exists', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), 'test.txt\n', 'utf-8');

      const result = extendIgnoreFilter(tmpDir, undefined);

      assert.ok(result);
      assert.equal(result!.ignores('test.txt'), true);
      assert.equal(result!.ignores('other.ts'), false);
    });

    it('returns undefined when no .ragignore and no parent', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));

      const result = extendIgnoreFilter(tmpDir, undefined);

      assert.equal(result, undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // collectRagignorePatterns
  // ---------------------------------------------------------------------------
  describe('collectRagignorePatterns', () => {
    it('returns empty array when no .ragignore files anywhere', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const subDir = path.join(tmpDir, 'src', 'deep');
      mkdirSync(subDir, { recursive: true });

      const result = collectRagignorePatterns(tmpDir, subDir);

      assert.deepEqual(result, []);
    });

    it('collects patterns from root + subdirectory (root first, then subdir)', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const subDir = path.join(tmpDir, 'src', 'deep');
      mkdirSync(subDir, { recursive: true });

      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), '*.log\n', 'utf-8');
      writeFileSync(path.join(tmpDir, 'src', RAGIGNORE_FILENAME), 'build/\n', 'utf-8');

      const result = collectRagignorePatterns(tmpDir, subDir);

      assert.equal(result.length, 2);
      assert.equal(result[0], '*.log\n');
      assert.equal(result[1], 'build/\n');
    });

    it('handles startDir === rootDir (only checks root)', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), '*.snap\n', 'utf-8');

      // No subdir .ragignore, but root has one
      const subDir = path.join(tmpDir, 'src');
      mkdirSync(subDir, { recursive: true });

      const result = collectRagignorePatterns(tmpDir, tmpDir);

      assert.equal(result.length, 1);
      assert.equal(result[0], '*.snap\n');
    });

    it('collects from startDir upward when rootDir is not an ancestor of startDir', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const otherDir = mkdtempSync(path.join(tmpdir(), 'ragignore-other-'));

      writeFileSync(path.join(otherDir, RAGIGNORE_FILENAME), '*.tmp\n', 'utf-8');

      // rootDir is tmpDir, startDir is otherDir — they're siblings, not ancestors.
      // The function starts from startDir and goes up, so it will find the
      // .ragignore in otherDir but will never reach tmpDir (rootDir).
      const result = collectRagignorePatterns(tmpDir, otherDir);

      // Patterns from startDir are still collected; rootDir just won't be found
      assert.deepEqual(result, ['*.tmp\n']);
    });
  });

  // ---------------------------------------------------------------------------
  // buildFilterForPath
  // ---------------------------------------------------------------------------
  describe('buildFilterForPath', () => {
    it('returns undefined when no .ragignore files', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const subDir = path.join(tmpDir, 'src');
      mkdirSync(subDir, { recursive: true });

      const result = buildFilterForPath(tmpDir, subDir);

      assert.equal(result, undefined);
    });

    it('creates combined filter that correctly handles hierarchical negation', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const subDir = path.join(tmpDir, 'src');
      mkdirSync(subDir, { recursive: true });

      // Root ignores all .log files, but src overrides to keep important.log
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), '*.log\n', 'utf-8');
      writeFileSync(path.join(subDir, RAGIGNORE_FILENAME), '!important.log\n', 'utf-8');

      const filter = buildFilterForPath(tmpDir, subDir);

      assert.ok(filter);
      assert.equal(filter!.ignores('foo.log'), true);
      assert.equal(filter!.ignores(path.join('src', 'foo.log')), true);
      assert.equal(filter!.ignores('important.log'), false);
      assert.equal(filter!.ignores(path.join('src', 'important.log')), false);
      assert.equal(filter!.ignores('README.md'), false);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: combined filter with hierarchical negation ignore behavior
  // ---------------------------------------------------------------------------
  describe('integration', () => {
    it('combined filter correctly handles patterns from multiple levels', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));
      const srcDir = path.join(tmpDir, 'src', 'components');
      mkdirSync(srcDir, { recursive: true });

      // Root: ignore node_modules/
      writeFileSync(path.join(tmpDir, RAGIGNORE_FILENAME), 'node_modules/\n', 'utf-8');
      // src: ignore .snap files
      writeFileSync(path.join(tmpDir, 'src', RAGIGNORE_FILENAME), '*.snap\n', 'utf-8');

      const filter = buildFilterForPath(tmpDir, srcDir);

      assert.ok(filter);

      // node_modules/pkg/index.js → ignored (root pattern)
      assert.equal(filter!.ignores('node_modules/pkg/index.js'), true);
      // src/components/test.snap → ignored (src pattern — paths are relative to filter root)
      assert.equal(filter!.ignores(path.join('src', 'components', 'test.snap')), true);
      // src/components/app.ts → NOT ignored
      assert.equal(filter!.ignores(path.join('src', 'components', 'app.ts')), false);
      // README.md → NOT ignored
      assert.equal(filter!.ignores('README.md'), false);
    });

    it('exposes the RAGIGNORE_FILENAME constant', () => {
      assert.equal(RAGIGNORE_FILENAME, '.ragignore');
    });

    it('walkFiles correctly filters using hierarchical .ragignore patterns', async () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'ragignore-test-'));

      // Create directory structure
      const srcDir = path.join(tmpDir, 'src');
      const distDir = path.join(tmpDir, 'dist');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(distDir, { recursive: true });

      // Create files
      writeFileSync(path.join(tmpDir, '.ragignore'), '*.log\n', 'utf-8');
      writeFileSync(path.join(srcDir, 'main.ts'), 'console.log("hello");\n', 'utf-8');
      writeFileSync(path.join(srcDir, 'debug.log'), 'debug info\n', 'utf-8');
      writeFileSync(path.join(srcDir, '.ragignore'), '!important.log\n', 'utf-8');
      writeFileSync(path.join(srcDir, 'important.log'), 'important info\n', 'utf-8');
      writeFileSync(path.join(distDir, 'output.js'), '// output\n', 'utf-8');

      const extensionsSet = new Set(['.ts', '.log', '.js']);
      const excludeDirsSet = new Set(['dist']);
      const rootFilter = buildFilterForPath(tmpDir, tmpDir);

      const result = await walkFiles(tmpDir, extensionsSet, excludeDirsSet, tmpDir, rootFilter);

      const normalize = (p: string) => path.relative(tmpDir, p).replace(/\\/g, '/');
      const relativePaths = result.map(normalize).sort();

      assert.deepEqual(relativePaths, ['src/important.log', 'src/main.ts']);
    });
  });
});
