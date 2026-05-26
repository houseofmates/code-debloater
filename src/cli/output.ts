import type { CommentIssue } from '../core/scanners/commentScanner.js';
import type { FunctionInfo } from '../core/scanners/astScanner.js';
import type { AuditSummary } from '../core/issueScorer.js';
import type { FixResult } from '../core/fixer.js';
import { VERSION } from '../config.js';

export interface ScanReport {
  version: string;
  meta: {
    scannedFiles: number;
    scannedDirs: string;
    durationMs: number;
  };
  issues: {
    placeholders: Array<{
      file: string;
      line: number;
      text: string;
      type: string;
    }>;
    duplicates: Array<{
      clusterIndex: number;
      count: number;
      functions: Array<{
        name: string;
        file: string;
        line: number;
      }>;
    }>;
  };
  summary: {
    healthScore: number;
    grade: string;
    severity: string;
    totalIssues: number;
    placeholderCount: number;
    duplicateCount: number;
  };
  fixes?: Array<{
    file: string;
    line: number;
    status: string;
    error?: string;
  }>;
}

export function buildReport(
  commentIssues: CommentIssue[],
  duplicateClusters: FunctionInfo[][],
  summary: AuditSummary,
  fixes: FixResult[] | null,
  meta: { scannedFiles: number; scannedDirs: string; durationMs: number },
): ScanReport {
  return {
    version: VERSION,
    meta,
    issues: {
      placeholders: commentIssues.map((i) => ({
        file: i.filePath,
        line: i.line,
        text: i.text,
        type: i.type,
      })),
      duplicates: duplicateClusters.map((cluster, idx) => ({
        clusterIndex: idx + 1,
        count: cluster.length,
        functions: cluster.map((fn) => ({
          name: fn.name,
          file: fn.filePath,
          line: fn.line,
        })),
      })),
    },
    summary: {
      healthScore: summary.healthScore,
      grade: summary.grade,
      severity: summary.severity,
      totalIssues: commentIssues.length + duplicateClusters.length,
      placeholderCount: commentIssues.length,
      duplicateCount: duplicateClusters.length,
    },
    fixes: fixes
      ? fixes.map((f) => ({
          file: f.filePath,
          line: f.line,
          status: f.status,
          error: f.error,
        }))
      : undefined,
  };
}

export function renderJsonReport(
  commentIssues: CommentIssue[],
  duplicateClusters: FunctionInfo[][],
  summary: AuditSummary,
  fixes: FixResult[] | null,
  meta: { scannedFiles: number; scannedDirs: string; durationMs: number },
): string {
  const report = buildReport(commentIssues, duplicateClusters, summary, fixes, meta);
  return JSON.stringify(report, null, 2);
}

export function renderCsvReport(
  commentIssues: CommentIssue[],
  duplicateClusters: FunctionInfo[][],
): string {
  const lines: string[] = ['type,file,line,text'];

  for (const issue of commentIssues) {
    const text = `"${issue.text.replace(/"/g, '""')}"`;
    lines.push(`placeholder,${issue.filePath},${issue.line},${text}`);
  }

  for (const [idx, cluster] of duplicateClusters.entries()) {
    for (const fn of cluster) {
      lines.push(`duplicate,${fn.filePath},${fn.line},"Cluster #${idx + 1}: ${fn.name}()"`);
    }
  }

  return lines.join('\n') + '\n';
}