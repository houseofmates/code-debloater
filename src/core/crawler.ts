import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const IGNORED_DIRECTORIES = new Set([
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
 * Recursively crawls a target directory for JavaScript/TypeScript files.
 */
export async function crawlDirectory(dir: string): Promise<string[]> {
  const fileList: string[] = [];

  async function walk(currentDir: string) {
    try {
      const dirents = await readdir(currentDir, { withFileTypes: true });

      for (const dirent of dirents) {
        const file = dirent.name;

        if (file.startsWith('.') || IGNORED_DIRECTORIES.has(file)) {
          continue;
        }

        const fullPath = join(currentDir, file);

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

  await walk(dir);
  return fileList;
}