import { readFile, writeFile } from 'fs/promises';

export interface NIMConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  temperature: number;
}

export function loadConfig(): NIMConfig {
  const apiKey = process.env.NVIDIA_API_KEY || '';
  const model = process.env.CODE_DEBLOATER_MODEL || 'deepseek-ai/deepseek-v4-pro';

  if (!apiKey) {
    throw new Error(
      'NVIDIA_API_KEY is required.\n' +
      'Get your free API key from https://integrate.nvidia.com and set it:\n' +
      '  export NVIDIA_API_KEY=nvapi-...\n' +
      'Optionally set model:\n' +
      '  export CODE_DEBLOATER_MODEL=deepseek-ai/deepseek-v4-pro'
    );
  }

  return {
    apiKey,
    model,
    baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    maxTokens: 8192,
    temperature: 0.1,
  };
}

interface Choice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

interface NIMResponse {
  id: string;
  choices: Choice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function queryNIM(
  config: NIMConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    const truncated = body.length > 500 ? body.slice(0, 500) + '…' : body;
    throw new Error(
      `NVIDIA NIM API error ${response.status} ${response.statusText}\n${truncated}`,
    );
  }

  const data = (await response.json()) as NIMResponse;
  const content = data.choices?.[0]?.message?.content?.trim() || '';

  // Strip markdown code fences if the model wraps its output
  return content.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/gm, '$1').trim();
}

/**
 * Replaces a placeholder comment / lazy stub line with real implementation
 * by sending the full file context to DeepSeek V4 Pro via NVIDIA NIM.
 * Returns the rewritten file content.
 */
export async function fixPlaceholder(
  filePath: string,
  lineNumber: number,
  placeholderText: string,
  config: NIMConfig = loadConfig(),
): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8');

  const systemPrompt = `You are an expert software engineer specialized in writing production-grade code. Your task is to replace a lazy placeholder comment or stub with a real, working implementation.

Rules:
- Output ONLY the complete updated file source code — nothing else.
- No explanations, no markdown wrappers, no "here's the fixed version".
- Preserve every line that isn't the problematic placeholder.
- Match the existing code style (indentation, naming conventions, etc.).
- If the placeholder describes a feature, implement it properly.
- If there's not enough context to implement correctly, output only the file with a concise TODO comment that specifies exactly what's needed.`;

  const userPrompt = `File: ${filePath}
Line ${lineNumber} — placeholder comment: ${placeholderText}

Full file content:
\`\`\`
${fileContent}
\`\`\`

Replace the placeholder with real production code. Output the entire updated file.`;

  const result = await queryNIM(config, systemPrompt, userPrompt);
  if (result.length < 10) {
    throw new Error(`NIM returned an empty or too-short replacement for ${filePath}`);
  }
  return result;
}

/**
 * Analyzes two structurally duplicate functions and returns a concrete
 * refactoring strategy for merging them into a shared helper.
 */
export async function analyzeDuplicate(
  file1: string,
  line1: number,
  name1: string,
  content1: string,
  file2: string,
  line2: number,
  name2: string,
  content2: string,
  config: NIMConfig = loadConfig(),
): Promise<string> {
  const systemPrompt = `You are a senior software architect. Two functions in different files are structurally identical (same logic, same AST shape). Your job is to produce a precise, actionable refactoring plan to eliminate the duplication.

The plan must include:
1. The extracted shared function signature and body
2. Which file(s) it should live in (a shared utils/helpers module, or adapt to the project structure)
3. How each original file imports and calls the shared function
4. Any parameterization needed to handle differences

Be concise and specific — show exact code snippets.`;

  const userPrompt = `Duplicate function A:
  "${name1}()" in ${file1} at line ${line1}
  \`\`\`
  ${content1}
  \`\`\`

Duplicate function B:
  "${name2}()" in ${file2} at line ${line2}
  \`\`\`
  ${content2}
  \`\`\`

Provide a clean refactoring strategy to merge these into a single shared helper.`;

  return await queryNIM(config, systemPrompt, userPrompt);
}