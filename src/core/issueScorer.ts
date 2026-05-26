import { CommentIssue } from './scanners/commentScanner.js';
import { FunctionInfo } from './scanners/astScanner.js';

export interface AuditSummary {
  healthScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  severity: 'low' | 'medium' | 'high' | 'critical';
  strengths: string[];
  risks: string[];
}

const COMMENT_WEIGHT: Record<CommentIssue['type'], number> = {
  placeholder: 10,
  todo: 6
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateGrade(score: number): AuditSummary['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function calculateSeverity(score: number, commentIssues: CommentIssue[], duplicateClusters: FunctionInfo[][]): AuditSummary['severity'] {
  if (duplicateClusters.some((cluster) => cluster.length >= 4) || commentIssues.length >= 12 || score <= 30) {
    return 'critical';
  }
  if (duplicateClusters.length >= 2 || commentIssues.length >= 6 || score <= 55) {
    return 'high';
  }
  if (duplicateClusters.length === 1 || commentIssues.length >= 3 || score <= 75) {
    return 'medium';
  }
  return 'low';
}

function buildRecommendations(commentIssues: CommentIssue[], duplicateClusters: FunctionInfo[][]): string[] {
  const recommendations: string[] = [];

  if (commentIssues.length > 0) {
    recommendations.push('Resolve lazy and placeholder comments first to prevent hidden technical debt.');
  }

  if (duplicateClusters.length > 0) {
    recommendations.push('Refactor duplicated logic into shared helpers or utility functions.');
  }

  if (commentIssues.length === 0 && duplicateClusters.length === 0) {
    recommendations.push('Maintain this quality by running code-debloater regularly after every major feature or refactor.');
  }

  if (duplicateClusters.some((cluster) => cluster.length >= 3)) {
    recommendations.push('Large duplicate clusters are high-value refactor targets and should be addressed first.');
  }

  return recommendations;
}

export function calculateAuditSummary(commentIssues: CommentIssue[], duplicateClusters: FunctionInfo[][]): AuditSummary {
  const initialScore = 100;

  const commentPenalty = commentIssues.reduce((total, issue) => total + COMMENT_WEIGHT[issue.type], 0);
  const duplicatePenalty = duplicateClusters.reduce((total, cluster) => {
    if (cluster.length >= 5) return total + 28;
    if (cluster.length === 4) return total + 22;
    if (cluster.length === 3) return total + 16;
    return total + 10;
  }, 0);

  const clusterBonus = duplicateClusters.length > 0 ? duplicateClusters.length * 2 : 0;
  const totalPenalty = commentPenalty + duplicatePenalty + clusterBonus;
  const rawScore = initialScore - totalPenalty;
  const healthScore = clampScore(rawScore);

  return {
    healthScore,
    grade: calculateGrade(healthScore),
    severity: calculateSeverity(healthScore, commentIssues, duplicateClusters),
    strengths: commentIssues.length === 0 && duplicateClusters.length === 0 ? ['Codebase is clean and ready for production'] : [],
    risks: buildRecommendations(commentIssues, duplicateClusters)
  };
}
