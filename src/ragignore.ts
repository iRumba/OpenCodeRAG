import ignore, { Ignore } from 'ignore';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

export const RAGIGNORE_FILENAME = '.ragignore';

/**
 * Load the content of a .ragignore file synchronously.
 * Returns null if file doesn't exist or can't be read.
 */
export function loadRagignoreFileSync(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Load the content of a .ragignore file asynchronously.
 * Returns null if file doesn't exist or can't be read.
 */
export async function loadRagignoreFile(filePath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Attempt to load .ragignore content from a directory.
 * Returns null if the file is missing, unreadable, or contains only whitespace.
 */
export function loadRagignoreFromDir(dirPath: string): string | null {
  const ragignorePath = path.resolve(dirPath, RAGIGNORE_FILENAME);
  const content = loadRagignoreFileSync(ragignorePath);

  // Treat empty or whitespace-only files as missing — no patterns to add
  if (content !== null && content.trim().length === 0) {
    return null;
  }

  return content;
}

/**
 * Extend an Ignore filter with patterns from a .ragignore file in the given directory.
 * Returns a NEW Ignore instance that combines parentFilter + new patterns.
 * If no .ragignore exists, returns parentFilter.
 * If no .ragignore and no parentFilter, returns undefined.
 */
export function extendIgnoreFilter(
  dirPath: string,
  parentFilter?: Ignore,
): Ignore | undefined {
  const resolvedDir = path.resolve(dirPath);
  const content = loadRagignoreFromDir(resolvedDir);

  // No .ragignore file — return parentFilter as-is (or undefined if absent)
  if (content === null) {
    return parentFilter;
  }

  // Build new filter: clone parent patterns, then add .ragignore patterns
  const filter = ignore();
  if (parentFilter) {
    filter.add(parentFilter);
  }
  filter.add(content);

  return filter;
}

/**
 * Collect all .ragignore patterns from ancestor directories
 * (from startDir up to rootDir, returned in root->leaf order)
 * and return them as an array of content strings.
 */
export function collectRagignorePatterns(
  rootDir: string,
  startDir: string,
): string[] {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedStart = path.resolve(startDir);

  const patterns: string[] = [];
  let currentDir = resolvedStart;

  while (true) {
    const content = loadRagignoreFromDir(currentDir);
    if (content !== null) {
      patterns.push(content);
    }

    // Stop once we've reached the root directory
    if (currentDir === resolvedRoot) {
      break;
    }

    const parentDir = path.dirname(currentDir);

    // Stop at the filesystem root to prevent infinite loops
    // when rootDir is not an ancestor of startDir
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  // Patterns were collected leaf→root; reverse for root→leaf order
  return patterns.reverse();
}

/**
 * Build a single Ignore instance from all .ragignore patterns
 * collected from ancestor directories (root → leaf order).
 * Returns undefined if no .ragignore files found.
 */
export function buildFilterForPath(
  rootDir: string,
  targetDir: string,
): Ignore | undefined {
  const patterns = collectRagignorePatterns(rootDir, targetDir);

  if (patterns.length === 0) {
    return undefined;
  }

  const filter = ignore();
  for (const content of patterns) {
    filter.add(content);
  }

  return filter;
}
