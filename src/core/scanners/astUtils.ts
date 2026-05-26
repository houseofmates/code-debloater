import ts from 'typescript';

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

export function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'mts' || ext === 'cts') return ts.ScriptKind.TS;
  if (ext === 'mjs' || ext === 'cjs') return ts.ScriptKind.JS;
  return SCRIPT_KINDS[`.${ext}`] ?? ts.ScriptKind.JS;
}

export function resolveFunctionName(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) {
      return (parent.name as ts.Identifier).text || (parent.name as ts.StringLiteral).text;
    }
  }
  return 'anonymous';
}

export function getLineCount(node: ts.Node, sourceFile: ts.SourceFile): number {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
  return end - start + 1;
}