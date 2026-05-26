import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { CommentIssue } from '../core/scanners/commentScanner.js';
import type { FunctionInfo } from '../core/scanners/astScanner.js';
import type { AuditSummary } from '../core/issueScorer.js';
import type { FixResult } from '../core/fixer.js';
import type { PolishResult } from '../core/polisher.js';
import { VERSION } from '../config.js';

export function renderIntro(): void {
  p.intro(pc.bgCyan(pc.black(' code-debloater ')));
  p.log.info(pc.dim(`v${VERSION} · ast bloat scanner · nvidia nim (deepseek v4 pro)`));
}

export function createSpinner() {
  return p.spinner();
}

function colorizeType(type: 'placeholder' | 'todo'): string {
  return type === 'todo' ? pc.red('TODO') : pc.yellow('PLACEHOLDER');
}

function shortenPath(fp: string): string {
  return fp.split('/').slice(-3).join('/');
}

const severityColors: Record<string, (s: string) => string> = {
  low: (s: string) => pc.green(s),
  medium: (s: string) => pc.yellow(s),
  high: (s: string) => pc.red(s),
  critical: (s: string) => pc.bgRed(pc.white(` ${s} `)),
};

export function renderReport(
  commentIssues: CommentIssue[],
  duplicateClusters: FunctionInfo[][],
  summary: AuditSummary,
  verbose: boolean = false,
): void {
  const color = severityColors[summary.severity] || ((s: string) => s);
  const severityLabel = color(summary.severity.toUpperCase());

  p.note(
    [
      `${pc.bold('audit report')}`,
      `  • ${pc.yellow(String(commentIssues.length))} placeholder/todo comments`,
      `  • ${pc.red(String(duplicateClusters.length))} duplicate logic clusters`,
      `  • ${pc.green(String(commentIssues.length + duplicateClusters.length))} total issues`,
      `  • ${pc.bold('health:')} ${renderHealthBar(summary.healthScore)} ${pc.bold(String(summary.healthScore))}/100 (${pc.bold(summary.grade)})`,
      `  • ${pc.bold('severity:')} ${severityLabel}`,
    ].join('\n'),
    color('analysis complete'),
  );

  if (summary.strengths.length > 0) {
    p.log.success(pc.green('strengths:'));
    for (const s of summary.strengths) p.log.step(`  • ${s}`);
  }
  if (summary.risks.length > 0) {
    p.log.warn(pc.yellow('recommendations:'));
    for (const r of summary.risks) p.log.step(`  • ${r}`);
  }

  if (commentIssues.length > 0) {
    p.log.warn(pc.yellow(pc.bold('⚠  placeholder & todo issues:')));
    for (const issue of commentIssues) {
      const label = colorizeType(issue.type);
      const line = pc.magenta(String(issue.line));
      const text = verbose ? issue.text : issue.text.slice(0, 90);
      p.log.step(
        `${pc.cyan(shortenPath(issue.filePath))}:${line} ${pc.gray(`[${label}]`)}\n` +
          `   ${pc.gray(text)}`,
      );
    }
  }

  if (duplicateClusters.length > 0) {
    p.log.error(pc.red(pc.bold('🚨 structural duplicates:')));
    for (const [idx, cluster] of duplicateClusters.entries()) {
      p.log.step(`${pc.bold(`cluster #${idx + 1}`)} — ${pc.yellow(String(cluster.length))} matches:`);
      for (const fn of cluster) {
        p.log.message(
          `   • ${pc.green(fn.name)}() in ${pc.cyan(shortenPath(fn.filePath))}:${pc.magenta(String(fn.line))}`,
        );
      }
    }
    p.note(
      'ast-normalized (variable names & literals stripped). renamed variables do not hide duplicates.',
      'duplicate detector',
    );
  }
}

function renderHealthBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  if (score >= 80) return pc.green(bar);
  if (score >= 60) return pc.yellow(bar);
  if (score >= 40) return pc.red(bar);
  return pc.bgRed(pc.white(bar));
}

export async function promptForFix(model: string): Promise<boolean> {
  const choice = await p.confirm({
    message: `fix placeholders with nvidia nim (${model})?`,
    initialValue: true,
  });
  return typeof choice === 'boolean' ? choice : false;
}

export async function promptForPolish(): Promise<boolean> {
  const choice = await p.confirm({
    message: 'run deep code quality improvement pass on flagged files?',
    initialValue: true,
  });
  return typeof choice === 'boolean' ? choice : false;
}

export function renderMessage(
  msg: string,
  type: 'info' | 'success' | 'error' | 'warn' = 'info',
): void {
  switch (type) {
    case 'success':
      p.log.success(pc.green(msg));
      break;
    case 'error':
      p.log.error(pc.red(msg));
      break;
    case 'warn':
      p.log.warn(pc.yellow(msg));
      break;
    default:
      p.log.info(pc.dim(msg));
  }
}

export function renderOutro(msg = 'code lean, mean, and clean!'): void {
  p.outro(pc.bgCyan(pc.black(` ${msg} `)));
}

/**
 * Render a colored unified diff of a file change.
 */
export function renderDiff(
  filePath: string,
  originalContent: string,
  newContent: string,
): void {
  const origLines = originalContent.split('\n');
  const newLines = newContent.split('\n');
  const short = shortenPath(filePath);

  console.log(pc.cyan(`\n  ── ${short} ──`));

  let contextBuf: Array<{ type: string; line: string }> = [];

  function flushContext() {
    if (contextBuf.length > 6) {
      console.log(pc.gray(`    ${pc.dim('…')} ${contextBuf.length - 4} unchanged lines ${pc.dim('…')}`));
      contextBuf = contextBuf.slice(-2);
    }
    for (const c of contextBuf) {
      const prefix = c.type === 'same' ? ' ' : c.type === 'add' ? '+' : '-';
      const color = c.type === 'same' ? pc.dim : c.type === 'add' ? pc.green : pc.red;
      console.log(color(`  ${prefix} ${c.line}`));
    }
    contextBuf = [];
  }

  const maxLines = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLines; i++) {
    const o = i < origLines.length ? origLines[i] : null;
    const n = i < newLines.length ? newLines[i] : null;

    if (o === n) {
      contextBuf.push({ type: 'same', line: o! });
      if (contextBuf.length > 6) flushContext();
    } else {
      flushContext();
      if (o !== null) console.log(pc.red(`  - ${o}`));
      if (n !== null) console.log(pc.green(`  + ${n}`));
    }
  }
  flushContext();
  console.log();
}

/**
 * Render a summary table of fix results.
 */
export function renderFixSummary(results: FixResult[]): void {
  const fixed = results.filter((r) => r.status === 'fixed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const total = results.length;

  if (total === 0) return;

  const parts: string[] = [];
  if (fixed > 0) parts.push(pc.green(`${fixed} fixed`));
  if (skipped > 0) parts.push(pc.blue(`${skipped} previewed`));
  if (errors > 0) parts.push(pc.red(`${errors} errors`));

  p.note(parts.join(' · '), 'fix results');

  if (errors > 0) {
    for (const r of results) {
      if (r.status === 'error' && r.error) {
        p.log.warn(pc.yellow(`  ${shortenPath(r.filePath)}:${r.line} — ${r.error}`));
      }
    }
  }
}

/**
 * Render polish pass results.
 */
export function renderPolishSummary(results: PolishResult[]): void {
  const improved = results.filter((r) => r.status === 'improved').length;
  const unchanged = results.filter((r) => r.status === 'unchanged').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const total = results.length;

  if (total === 0) return;

  const parts: string[] = [];
  if (improved > 0) parts.push(pc.green(`${improved} improved`));
  if (unchanged > 0) parts.push(pc.dim(`${unchanged} already clean`));
  if (errors > 0) parts.push(pc.red(`${errors} errors`));

  p.note(parts.join(' · '), 'polish results');
}

/**
 * Render per-file issue breakdown (verbose mode).
 */
export function renderFileBreakdown(
  commentIssues: CommentIssue[],
  duplicateClusters: FunctionInfo[][],
): void {
  const fileMap = new Map<string, { placeholders: number; todos: number; duplicates: number }>();

  for (const issue of commentIssues) {
    const entry = fileMap.get(issue.filePath) || { placeholders: 0, todos: 0, duplicates: 0 };
    if (issue.type === 'todo') entry.todos++;
    else entry.placeholders++;
    fileMap.set(issue.filePath, entry);
  }

  for (const cluster of duplicateClusters) {
    for (const fn of cluster) {
      const entry = fileMap.get(fn.filePath) || { placeholders: 0, todos: 0, duplicates: 0 };
      entry.duplicates++;
      fileMap.set(fn.filePath, entry);
    }
  }

  if (fileMap.size === 0) return;

  p.log.info(pc.bold(pc.cyan('\n  per-file breakdown:')));
  const sorted = [...fileMap.entries()].sort((a, b) => {
    const sumA = a[1].placeholders + a[1].todos + a[1].duplicates;
    const sumB = b[1].placeholders + b[1].todos + b[1].duplicates;
    return sumB - sumA;
  });

  for (const [file, counts] of sorted) {
    const parts: string[] = [];
    if (counts.placeholders > 0) parts.push(pc.yellow(`p:${counts.placeholders}`));
    if (counts.todos > 0) parts.push(pc.red(`t:${counts.todos}`));
    if (counts.duplicates > 0) parts.push(pc.magenta(`d:${counts.duplicates}`));
    p.log.message(`  ${pc.cyan(shortenPath(file))}  ${parts.join(' · ')}`);
  }
  console.log();
}