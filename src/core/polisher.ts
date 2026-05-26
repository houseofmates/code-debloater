import { readFile, writeFile } from 'fs/promises';
import { queryNIM, type NIMConfig } from '../ai/nimConnector.js';

export interface PolishResult {
  filePath: string;
  status: 'improved' | 'unchanged' | 'error';
  originalContent: string;
  newContent: string;
  error?: string;
  summary?: string;
}

/**
 * Send a file to DeepSeek V4 Pro for code quality improvement.
 * The model reviews the code and returns an improved version.
 */
export async function polishFile(
  filePath: string,
  config: NIMConfig,
  dryRun: boolean,
): Promise<PolishResult> {
  const originalContent = await readFile(filePath, 'utf-8');

  // Skip tiny files (empty, single-line, etc.)
  if (originalContent.trim().length < 30) {
    return {
      filePath,
      status: 'unchanged',
      originalContent,
      newContent: originalContent,
      summary: 'file too small to improve',
    };
  }

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const isTs = ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts';
  const isJs = ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs';

  const systemPrompt = `You are an expert code reviewer and software architect. Your job is to improve a ${isTs ? 'TypeScript' : 'JavaScript'} file's quality.

Rules:
- Output ONLY the complete updated file source code — nothing else.
- No explanations, no markdown, no "here's the improved version".
- Preserve the file's existing style, imports, and overall structure.
- If the file is already clean, output it unchanged.

Improvement areas (in priority order):
1. Add missing type annotations (if TypeScript)
2. Improve variable and function naming for clarity
3. Reduce unnecessary nesting with early returns / guard clauses
4. Replace repeated expressions with extracted helpers
5. Use modern syntax where clearer (optional chaining, nullish coalescing, arrow functions)
6. Add basic error handling for obvious failure points (file reads, network calls, null checks)
7. Remove dead code or commented-out blocks
8. Simplify overly complex conditionals

Do NOT:
- Change the public API or export signatures
- Restructure the module layout
- Add dependencies
- Change behavior`;

  const userPrompt = `Review and improve this ${ext} file:

\`\`\`${ext}
${originalContent}
\`\`\`

Output the improved file. If it's already clean, output it as-is.`;

  try {
    const result = await queryNIM(config, systemPrompt, userPrompt);

    if (!result || result.length < 10) {
      return {
        filePath,
        status: 'error',
        originalContent,
        newContent: originalContent,
        error: 'model returned empty response',
      };
    }

    // If result is identical or only whitespace-different, mark unchanged
    if (result.trim() === originalContent.trim()) {
      return {
        filePath,
        status: 'unchanged',
        originalContent,
        newContent: originalContent,
      };
    }

    if (dryRun) {
      return {
        filePath,
        status: 'improved',
        originalContent,
        newContent: result,
      };
    }

    await writeFile(filePath, result, 'utf-8');
    return {
      filePath,
      status: 'improved',
      originalContent,
      newContent: result,
    };
  } catch (err) {
    return {
      filePath,
      status: 'error',
      originalContent,
      newContent: originalContent,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run polish pass on multiple files with concurrency control.
 */
export async function runPolish(
  filePaths: string[],
  config: NIMConfig,
  dryRun: boolean,
  maxConcurrent: number,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<PolishResult[]> {
  const results: PolishResult[] = [];
  const queue = [...filePaths];
  const total = queue.length;
  let completed = 0;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const filePath = queue.shift()!;
      const shortPath = filePath.split('/').pop() || filePath;
      onProgress?.(completed, total, shortPath);

      try {
        const result = await polishFile(filePath, config, dryRun);
        results.push(result);
      } catch (err) {
        results.push({
          filePath,
          status: 'error',
          originalContent: '',
          newContent: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }

      completed++;
      onProgress?.(completed, total, shortPath);
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, total || 1) }, () => worker());
  await Promise.all(workers);

  return results;
}