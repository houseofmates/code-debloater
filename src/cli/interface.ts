import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { CommentIssue } from '../core/scanners/commentScanner.js';
import type { FunctionInfo } from '../core/scanners/astScanner.js';
import type { AuditSummary } from '../core/issueScorer.js';

/**
 * Render the application welcome banner.
 */
export function renderIntro(): void {
  p.intro(pc.bgCyan(pc.black(' CODE-DEBLOATER ')));
  p.log.info(
    pc.dim('AST-driven bloat scanner · NVIDIA NIM (DeepSeek V4 Pro) powered'),
  );
}

/**
 * Simple spinner factory.
 */
export function createSpinner() {
  return p.spinner();
}

function colorizeType(type: 'placeholder' | 'todo'): string {
  return type === 'todo' ? pc.red('TODO') : pc.yellow('PLACEHOLDER');
}

/**
 * Formats a file path to show the last 3 segments.
 */
function shortenPath(filePath: string): string {
  return filePath.split('/').slice(-3).join('/');
}

/**
 * Prints the results of the placeholder and duplicate audit.
 */
export function renderReport(
  commentIssues: CommentIssue[],
  duplicateClusters: FunctionInfo[][],
  summary: AuditSummary,
  verbose: boolean = false,
): void {
  const severityLabel = {
    low: pc.green('LOW'),
    medium: pc.yellow('MEDIUM'),
    high: pc.red('HIGH'),
    critical: pc.bgRed(pc.white(' CRITICAL ')),
  }[summary.severity];

  p.note(
    [
      `${pc.bold('Audit Report:')}`,
      `  • ${pc.yellow(commentIssues.length)} placeholder/todo comments`,
      `  • ${pc.red(duplicateClusters.length)} duplicate logic clusters`,
      `  • ${pc.green(commentIssues.length + duplicateClusters.length)} total issues`,
      `  • ${pc.bold('Health Score:')} ${pc.bold(String(summary.healthScore))}/100 (${pc.bold(summary.grade)})`,
      `  • ${pc.bold('Severity:')} ${severityLabel}`,
    ].join('\n'),
    'Analysis Complete',
  );

  if (commentIssues.length === 0 && duplicateClusters.length > 0) {
    p.log.warn(
      pc.yellow('No placeholder comments, but duplicated logic needs attention.'),
    );
  }

  // Strengths & recommendations
  if (summary.strengths.length > 0) {
    p.log.success(pc.green('Strengths:'));
    for (const s of summary.strengths) p.log.step(`  • ${s}`);
  }
  if (summary.risks.length > 0) {
    p.log.error(pc.red('Recommended Actions:'));
    for (const r of summary.risks) p.log.step(`  • ${r}`);
  }

  // Placeholder comments
  if (commentIssues.length > 0) {
    p.log.warn(pc.yellow(pc.bold('⚠️  PLACEHOLDER & TODO COMMENT ISSUES:')));
    for (const issue of commentIssues) {
      const shortPath = shortenPath(issue.filePath);
      const label = colorizeType(issue.type);
      const line = pc.magenta(String(issue.line));
      const text = verbose ? issue.text : issue.text.slice(0, 80);
      p.log.step(
        `${pc.cyan(shortPath)}:${line} ${pc.gray(`[${label}]`)}\n` +
          `   ${pc.gray(text)}`,
      );
    }
  }

  // Structural duplicates
  if (duplicateClusters.length > 0) {
    p.log.error(pc.red(pc.bold('🚨 STRUCTURAL DUPLICATE LOGIC:')));
    for (const [index, cluster] of duplicateClusters.entries()) {
      p.log.step(
        `${pc.bold(`Cluster #${index + 1}`)} — ${pc.yellow(String(cluster.length))} matching functions:`,
      );
      for (const fn of cluster) {
        const shortPath = shortenPath(fn.filePath);
        p.log.message(
          `   • ${pc.green(fn.name)}() in ${pc.cyan(shortPath)}:${pc.magenta(String(fn.line))}`,
        );
      }
    }

    p.note(
      'Normalized by AST structure (variable names & formatting stripped), so renamed variables do not hide duplicates.',
      'Duplicate Detector',
    );
  }
}

/**
 * Prompt the user for auto-fix confirmation.
 */
export async function promptForFix(model: string): Promise<boolean> {
  const choice = await p.confirm({
    message: `Fix placeholders with NVIDIA NIM (${model})?`,
    initialValue: true,
  });

  return typeof choice === 'boolean' ? choice : false;
}

/**
 * Render a terminal message block.
 */
export function renderMessage(
  msg: string,
  type: 'info' | 'success' | 'error' = 'info',
): void {
  switch (type) {
    case 'success':
      p.log.success(pc.green(msg));
      break;
    case 'error':
      p.log.error(pc.red(msg));
      break;
    default:
      p.log.info(pc.dim(msg));
  }
}

/**
 * Render the outro banner.
 */
export function renderOutro(msg = 'Code lean, mean, and clean!'): void {
  p.outro(pc.bgCyan(pc.black(` ${msg} `)));
}