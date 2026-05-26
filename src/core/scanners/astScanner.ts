import { readFile } from 'fs/promises';
import ts from 'typescript';
import { getScriptKind, resolveFunctionName } from './astUtils.js';

export interface FunctionInfo {
  name: string;
  filePath: string;
  line: number;
  normalizedBody: string;
}

function normalizeFunctionBody(node: ts.Node, sourceFile: ts.SourceFile): string {
  const identifierMap = new Map<string, string>();
  let identifierCounter = 0;

  function getId(text: string): string {
    if (!identifierMap.has(text)) {
      identifierMap.set(text, `__id${++identifierCounter}`);
    }
    return identifierMap.get(text)!;
  }

  function isPreserved(child: ts.Identifier): boolean {
    const p = child.parent;
    return (
      (ts.isPropertyAccessExpression(p) && p.name === child) ||
      (ts.isPropertyAssignment(p) && p.name === child) ||
      (ts.isShorthandPropertyAssignment(p) && p.name === child) ||
      (ts.isPropertySignature(p) && p.name === child) ||
      (ts.isMethodDeclaration(p) && p.name === child) ||
      (ts.isMethodSignature(p) && p.name === child) ||
      ts.isQualifiedName(p)
    );
  }

  const transformer = (context: ts.TransformationContext) => {
    const visitor = (child: ts.Node): ts.VisitResult<ts.Node> => {
      if (ts.isIdentifier(child)) {
        return isPreserved(child) ? child : ts.factory.createIdentifier(getId(child.text));
      }
      if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
        return ts.factory.createStringLiteral('__str');
      }
      if (ts.isNumericLiteral(child)) {
        return ts.factory.createNumericLiteral('0');
      }
      if (ts.isBigIntLiteral(child)) {
        return ts.factory.createBigIntLiteral('0n');
      }
      if (ts.isRegularExpressionLiteral(child)) {
        return ts.factory.createRegularExpressionLiteral('/_/');
      }
      if (ts.isTemplateExpression(child)) {
        return ts.factory.createStringLiteral('__template');
      }
      return ts.visitEachChild(child, visitor, context);
    };
    return (root: ts.Node) => ts.visitNode(root, visitor);
  };

  const transformed = ts.transform(node, [transformer]);
  const printer = ts.createPrinter({ removeComments: true });
  const result = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], sourceFile);
  transformed.dispose();
  return result.replace(/\s+/g, '');
}

/**
 * Parses a JS/TS file and extracts its function bodies with AST-normalized forms.
 */
export async function extractFunctions(filePath: string): Promise<FunctionInfo[]> {
  const functions: FunctionInfo[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, getScriptKind(filePath));

    const parseDiags = (sourceFile as any).parseDiagnostics;
    if (parseDiags?.length > 0) {
      const msg = parseDiags.map((d: ts.Diagnostic) => d.messageText.toString()).join('; ');
      console.warn(`Warning: ${filePath} has parse issues: ${msg}`);
    }

    function visitor(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        if (node.body) {
          const normalized = normalizeFunctionBody(node.body, sourceFile);
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          if (normalized.length > 16) {
            functions.push({
              name: resolveFunctionName(node),
              filePath,
              line: line + 1,
              normalizedBody: normalized,
            });
          }
        }
      }
      ts.forEachChild(node, visitor);
    }
    visitor(sourceFile);
  } catch (error) {
    console.warn(`Failed to extract functions from ${filePath}: ${error}`);
  }

  return functions;
}

/**
 * Cluster functions by their normalized AST body to find structural duplicates.
 */
export function findDuplicates(allFunctions: FunctionInfo[]): FunctionInfo[][] {
  const clusters = new Map<string, FunctionInfo[]>();
  for (const fn of allFunctions) {
    const existing = clusters.get(fn.normalizedBody) || [];
    existing.push(fn);
    clusters.set(fn.normalizedBody, existing);
  }
  return [...clusters.values()]
    .filter((c) => c.length > 1)
    .sort((a, b) => b.length - a.length);
}