import { readFile } from 'fs/promises';

export interface CommentIssue {
  filePath: string;
  line: number;
  text: string;
  type: 'placeholder' | 'todo';
}

const COMMENT_REGEX = /\/\/.*|\/\*[\s\S]*?\*\//g;

const LAZY_AI_PATTERNS = [
  /\bTODO\b[:\s]*(?:implement|fix|complete|later|actual|refactor|replace|finish|add|write|do|handle)?/i,
  /\bFIXME\b/i,
  /\bTBD\b/i,
  /\bHACK\b/i,
  /\bXXX\b/i,
  /\bplaceholder\b/i,
  /AI[- ]generated/i,
  /auto[- ]generated/i,
  /auto-generated\s*stub/i,
  /insert\s+logic\s+here/i,
  /add\s+your\s+own\s+logic/i,
  /not\s+implemented/i,
  /pending\s+implementation/i,
  /temporary\s+stub/i,
  /generated\s+by\s+(?:AI|OpenAI|GPT|ChatGPT|Claude|Copilot)/i,
  /use\s+AI\s+to\s+generate/i,
  /unimplemented/i,
  /throw\s+new\s+Error\(['\"](?:Not implemented|TODO|Unimplemented|Not supported)['\"]\)/i,
  /this\s+(?:method|function|code)\s+is\s+generated/i,
  // Additional common AI stub patterns
  /\/\/\s*\.\.\.\s*(?:implement|fill|complete|add)/i,
  /\/\/\s*(?:your\s+)?code\s+(?:here|goes\s+here)/i,
  /\/\/\s*implement\s+(?:this|the\s+\w+)/i,
  /\bstub\b/i,
  /\bWIP\b/i,
  /needs\s+implementation/i,
  /to\s+be\s+implemented/i,
  /should\s+not\s+be\s+used/i,
  /work\s+in\s+progress/i,
  /require\s+implementation/i,
];

const TODO_TAGS = [/\bTODO\b/i, /\bFIXME\b/i];

function findLineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function normalizeCommentText(comment: string): string {
  return comment
    .replace(/\/\*|\*\//g, '')
    .replace(/^\/\//, '')
    .trim();
}

/**
 * Scans a file for lazy AI placeholder comments and returns matches.
 */
export async function scanComments(filePath: string): Promise<CommentIssue[]> {
  const issues: CommentIssue[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');

    for (const match of content.matchAll(COMMENT_REGEX)) {
      const rawComment = match[0];
      const startIndex = match.index ?? 0;
      const line = findLineNumber(content, startIndex);
      const comment = normalizeCommentText(rawComment);

      for (const pattern of LAZY_AI_PATTERNS) {
        if (pattern.test(comment)) {
          issues.push({
            filePath,
            line,
            text: comment,
            type: TODO_TAGS.some((tag) => tag.test(comment))
              ? 'todo'
              : 'placeholder',
          });
          break;
        }
      }
    }
  } catch (error) {
    console.warn(`Could not scan comments in ${filePath}: ${error}`);
  }

  return issues;
}