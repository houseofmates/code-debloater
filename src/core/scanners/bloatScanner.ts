import { readFile } from 'fs/promises';
import ts from 'typescript';
import { getScriptKind, resolveFunctionName, getLineCount } from './astUtils.js';

export interface BloatIssue {
  filePath: string;
  line: number;
  name: string;
  lines: number;
}

/**
 * Scan for oversized functions that may indicate bloat.
 */
export async function scanBloat(
  filePath: string,
  maxLines: number = 60,
): Promise<BloatIssue[]> {
  const issues: BloatIssue[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, getScriptKind(filePath));

    function visitor(node: ts.Node) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        if (node.body) {
          const lines = getLineCount(node, sourceFile);
          if (lines > maxLines) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            issues.push({
              filePath,
              line: line + 1,
              name: resolveFunctionName(node),
              lines,
            });
          }
        }
      }
      ts.forEachChild(node, visitor);
    }

    visitor(sourceFile);
  } catch {
    // Skip unparseable files
  }

  return issues;
}