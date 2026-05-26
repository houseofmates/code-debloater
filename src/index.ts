#!/usr/bin/env node

import process from 'process';
import { loadConfig, renderHelp, renderInitConfig, VERSION, type CodeDebloaterConfig } from './config.js';
import { crawlDirectory } from './core/crawler.js';
import { scanComments, type CommentIssue } from './core/scanners/commentScanner.js';
import { extractFunctions, findDuplicates, type FunctionInfo } from './core/scanners/astScanner.js';
import { scanBloat, type BloatIssue } from './core/scanners/bloatScanner.js';
import { calculateAuditSummary } from './core/issueScorer.js';
import { loadConfig as loadNimConfig, type NIMConfig } from './ai/nimConnector.js';
import { runFixes, analyzeDuplicateCluster } from './core/fixer.js';
import { renderJsonReport, renderCsvReport } from './cli/output.js';
import {
  renderIntro,
  createSpinner,
  renderReport,
  renderDiff,
  renderFixSummary,
  renderFileBreakdown,
  promptForFix,
  renderMessage,
  renderOutro,
} from './cli/interface.js';

async function main(): Promise<void> {
  const { config, targetDir, action } = await loadConfig(process.argv.slice(2));

  // --- Special actions ---
  if (action === 'help') {
    renderHelp();
    process.exit(0);
  }

  if (action === 'version') {
    console.log(`code-debloater v${VERSION}`);
    process.exit(0);
  }

  if (action === 'init') {
    renderIntro();
    await renderInitConfig(targetDir);
    renderOutro('Config created! Edit .code-debloaterrc to tweak defaults.');
    process.exit(0);
  }

  const s = createSpinner();
  const startTime = Date.now();
  renderIntro();

  // --- Step 1: Crawl ---
  s.start('Crawling project files...');
  const files = await crawlDirectory(targetDir, config.exclude, config.respectGitignore);

  if (files.length === 0) {
    s.stop('No JS/TS files found.');
    renderOutro('Nothing to scan.');
    process.exit(0);
  }

  s.message(`Scanning ${files.length} files...`);

  // --- Step 2: Scan ---
  const allCommentIssues: CommentIssue[] = [];
  const allBloatIssues: BloatIssue[] = [];
  let allFunctions: FunctionInfo[] = [];

  await Promise.all(
    files.map(async (file) => {
      const [comments, funcs, bloat] = await Promise.all([
        scanComments(file),
        extractFunctions(file),
        scanBloat(file, config.maxFunctionLines),
      ]);
      allCommentIssues.push(...comments);
      allBloatIssues.push(...bloat);
      allFunctions = allFunctions.concat(funcs);
    }),
  );

  // --- Step 3: Find duplicates ---
  const duplicateClusters = findDuplicates(allFunctions);
  const summary = calculateAuditSummary(allCommentIssues, duplicateClusters);

  s.stop('Scan complete!');

  const scanMeta = {
    scannedFiles: files.length,
    scannedDirs: targetDir,
    durationMs: Date.now() - startTime,
  };

  // --- Step 4: Report ---
  renderReport(allCommentIssues, duplicateClusters, summary, config.verbose);

  if (allBloatIssues.length > 0 && config.verbose) {
    for (const b of allBloatIssues) {
      renderMessage(
        `  📏 ${b.filePath}:${b.line} — ${b.name}() is ${b.lines} lines (limit: ${config.maxFunctionLines})`,
        'warn',
      );
    }
  }

  if (config.verbose) {
    renderFileBreakdown(allCommentIssues, duplicateClusters);
  }

  // --- Handle JSON/CSV output ---
  if (config.outputFormat === 'json') {
    const json = renderJsonReport(allCommentIssues, duplicateClusters, summary, null, scanMeta);
    if (config.outputFile) {
      const { writeFile } = await import('fs/promises');
      await writeFile(config.outputFile, json, 'utf-8');
      renderMessage(`Report written to ${config.outputFile}`, 'success');
    } else {
      console.log(json);
    }
    process.exit(summary.severity === 'critical' ? 1 : 0);
  }

  // --- Exit if nothing to fix ---
  if (allCommentIssues.length === 0 && duplicateClusters.length === 0) {
    renderOutro('Zero bloat — pristine!');
    process.exit(0);
  }

  if (config.scanOnly) {
    renderMessage('Scan complete. Run without --scan-only to auto-fix.', 'info');
    renderOutro('code-debloater — audit finished.');
    process.exit(summary.severity === 'high' || summary.severity === 'critical' ? 1 : 0);
  }

  // --- Step 5: Load NIM config ---
  let nimConfig: NIMConfig;
  try {
    nimConfig = loadNimConfig();
    if (config.model) nimConfig.model = config.model;
  } catch (err) {
    renderMessage(
      err instanceof Error ? err.message : 'Failed to load NVIDIA NIM config',
      'error',
    );
    process.exit(1);
  }

  // --- Step 6: Prompt for fix ---
  const shouldFix = config.autoFix ? true : await promptForFix(nimConfig.model);

  if (!shouldFix) {
    renderMessage('No fixes applied.', 'info');
    renderOutro('Run again anytime.');
    process.exit(0);
  }

  if (config.dryRun) {
    renderMessage('🔍 DRY RUN — no files will be modified.', 'warn');
  }

  // --- Step 7: Fix placeholders ---
  const items = allCommentIssues.map((issue) => ({
    path: issue.filePath,
    line: issue.line,
    text: issue.text,
  }));

  if (items.length > 0) {
    s.start(`Fixing ${items.length} placeholders via ${nimConfig.model}...`);

    const results = await runFixes(items, nimConfig, config.dryRun, config.maxConcurrent, (done, total, current) => {
      s.message(`Fixing placeholders (${done}/${total}) — ${current}`);
    });

    s.stop('Placeholder fixes complete.');

    // Render diffs in dry-run mode
    if (config.dryRun) {
      for (const r of results) {
        if (r.status === 'skipped' && r.originalContent && r.newContent) {
          renderDiff(r.filePath, r.originalContent, r.newContent);
        }
      }
    }

    renderFixSummary(results);
  }

  // --- Step 8: Analyze duplicates ---
  if (duplicateClusters.length > 0) {
    s.start('Analyzing duplicate logic...');

    for (let i = 0; i < duplicateClusters.length; i++) {
      const cluster = duplicateClusters[i];
      if (cluster.length < 2) continue;

      const fn1 = cluster[0];
      const fn2 = cluster[1];

      s.message(`Analyzing duplicate cluster #${i + 1}...`);

      try {
        const strategy = await analyzeDuplicateCluster(
          { filePath: fn1.filePath, line: fn1.line, name: fn1.name },
          { filePath: fn2.filePath, line: fn2.line, name: fn2.name },
          nimConfig,
        );
        renderMessage(`\n📐 Refactor Strategy — Cluster #${i + 1}:${strategy}`, 'info');
      } catch (err) {
        renderMessage(
          `  ❌ Analysis failed for cluster #${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    }

    s.stop('Duplicate analysis complete.');
  }

  // --- Done ---
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  renderMessage(`Completed in ${totalTime}s across ${files.length} files.`, 'success');
  renderOutro('Leaner, meaner, cleaner!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});