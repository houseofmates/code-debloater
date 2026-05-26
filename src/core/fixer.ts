import { readFile, writeFile } from 'fs/promises';
import { type NIMConfig, queryNIM } from '../ai/nimConnector.js';

export interface FixResult {
  filePath: string;
  line: number;
  text: string;
  status: 'fixed' | 'skipped' | 'error';
  error?: string;
  originalContent?: string;
  newContent?: string;
}

/**
 * Fix a single placeholder using NIM.
 */
export async function fixPlaceholder(
  filePath: string,
  lineNumber: number,
  placeholderText: string,
  config: NIMConfig,
  dryRun: boolean,
): Promise<FixResult> {
  const fileContent = await readFile(filePath, 'utf-8');
  const shortPath = filePath.split('/').pop() || filePath;

  const systemPrompt = `You are an expert software engineer. Replace a lazy placeholder comment or stub with real, working, production-grade code.

Rules:
- Output ONLY the complete updated file source code — nothing else.
- Preserve every line that isn't the problematic placeholder.
- Match existing code style (indentation, naming, conventions).
- If the placeholder describes a feature, implement it properly.
- If there's not enough context, replace with a specific actionable TODO.`;

  const userPrompt = `File: ${filePath}
Line ${lineNumber} — placeholder: ${placeholderText}

Full file:
\`\`\`
${fileContent}
\`\`\`

Replace the placeholder with real implementation. Output the entire updated file.`;

  const result = await queryNIM(config, systemPrompt, userPrompt);

  if (!result || result.length < 10) {
    return {
      filePath,
      line: lineNumber,
      text: placeholderText,
      status: 'error',
      error: 'NIM returned empty or too-short replacement',
    };
  }

  if (dryRun) {
    return {
      filePath,
      line: lineNumber,
      text: placeholderText,
      status: 'skipped',
      originalContent: fileContent,
      newContent: result,
    };
  }

  await writeFile(filePath, result, 'utf-8');
  return {
    filePath,
    line: lineNumber,
    text: placeholderText,
    status: 'fixed',
  };
}

/**
 * Analyze a duplicate function cluster using NIM.
 */
export async function analyzeDuplicateCluster(
  fn1: { filePath: string; line: number; name: string },
  fn2: { filePath: string; line: number; name: string },
  config: NIMConfig,
): Promise<string> {
  const content1 = await readFile(fn1.filePath, 'utf-8');
  const content2 = await readFile(fn2.filePath, 'utf-8');

  const start1 = Math.max(0, (fn1.line - 5) * 80);
  const end1 = Math.min(content1.length, (fn1.line + 30) * 80);
  const ctx1 = content1.slice(start1, end1);

  const start2 = Math.max(0, (fn2.line - 5) * 80);
  const end2 = Math.min(content2.length, (fn2.line + 30) * 80);
  const ctx2 = content2.slice(start2, end2);

  const systemPrompt = `You are a senior software architect. Two functions are structurally identical (same AST shape, different variable names). Produce a precise refactoring plan.

Include:
1. Shared function signature and body
2. Where it should live
3. How each file imports and calls it
4. Any parameterization needed`;

  const userPrompt = `Duplicate A: "${fn1.name}()" in ${fn1.filePath}:${fn1.line}
\`\`\`
${ctx1}
\`\`\`

Duplicate B: "${fn2.name}()" in ${fn2.filePath}:${fn2.line}
\`\`\`
${ctx2}
\`\`\`

Provide a clean refactoring strategy.`;

  return await queryNIM(config, systemPrompt, userPrompt);
}

/**
 * Run batched NIM fixes with concurrency control.
 */
export async function runFixes(
  items: Array<{ path: string; line: number; text: string }>,
  config: NIMConfig,
  dryRun: boolean,
  maxConcurrent: number,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<FixResult[]> {
  const results: FixResult[] = [];
  const queue = [...items];
  const total = queue.length;
  let completed = 0;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const shortPath = item.path.split('/').pop() || item.path;

      try {
        const result = await fixPlaceholder(item.path, item.line, item.text, config, dryRun);
        results.push(result);
        completed = results.filter((r) => r.status === 'fixed' || r.status === 'skipped').length;
        onProgress?.(completed, total, shortPath);
      } catch (err) {
        results.push({
          filePath: item.path,
          line: item.line,
          text: item.text,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        completed = results.filter((r) => r.status === 'fixed' || r.status === 'skipped').length;
        onProgress?.(completed, total, shortPath);
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, total || 1) }, () => worker());
  await Promise.all(workers);

  return results;
}