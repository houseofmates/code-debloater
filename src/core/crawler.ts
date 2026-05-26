import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';

const ALWAYS_IGNORE = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  'coverage',
  '.cache',
  '.turbo',
  '.vercel',
  '__pycache__',
  '.nyc_output',
  '.serverless',
  '.webpack',
]);

const TARGET_EXTENSIONS = /\.(js|ts|jsx|tsx|mjs|cjs|mts|cts)$/;

/**
 * Parse a .gitignore file and return array of glob patterns.
 */
async function loadGitignore(dir: string): Promise<string[]> {
  const patterns: string[] = [];
  // Walk up looking for .gitignore
  let current = dir;
  for (let i = 0; i < 5; i++) {
    try {
      const content = await readFile(join(current, '.gitignore'), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
      break;
    } catch {
      const parent = join(current, '..');
      if (parent === current) break;
      current = parent;
    }
  }
  return patterns;
}

/**
 * Check if a path matches any glob pattern.
 */
function matchesAny(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Handle leading slash (root-relative) by stripping it
    const p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
    if (minimatch(filePath, p) || minimatch(filePath, join(p, '**'))) return true;
    // Also match if the pattern is a directory name
    if (minimatch(filePath, `**/${p}/**`) || minimatch(filePath, `**/${p}`)) return true;
  }
  return false;
}

/**
 * Recursively crawl for JS/TS files with exclude support.
 */
export async function crawlDirectory(
  dir: string,
  excludePatterns: string[] = [],
  respectGitignore: boolean = true,
): Promise<string[]> {
  const fileList: string[] = [];
  const resolved = dir.startsWith('/') ? dir : join(process.cwd(), dir);

  // Load gitignore patterns
  const gitignorePatterns = respectGitignore ? await loadGitignore(resolved) : [];
  const allExcludes = [...new Set([...excludePatterns, ...gitignorePatterns])];

  async function walk(currentDir: string) {
    try {
      const dirents = await readdir(currentDir, { withFileTypes: true });

      for (const dirent of dirents) {
        const file = dirent.name;

        // Skip dotfiles and always-ignored directories
        if (file.startsWith('.') || (!dirent.isFile() && ALWAYS_IGNORE.has(file))) {
          continue;
        }

        const fullPath = join(currentDir, file);
        const relPath = relative(resolved, fullPath);

        // Check exclude patterns
        if (allExcludes.length > 0 && matchesAny(relPath, allExcludes)) {
          continue;
        }

        if (dirent.isDirectory()) {
          await walk(fullPath);
        } else if (dirent.isFile() && TARGET_EXTENSIONS.test(file)) {
          fileList.push(fullPath);
        }
      }
    } catch {
      // Silently skip unreadable directories
    }
  }

  await walk(resolved);
  return fileList;
}