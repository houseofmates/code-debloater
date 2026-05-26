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
import { runPolish } from './core/polisher.js';
import { renderJsonReport } from './cli/output.js';
import {
  renderIntro,
  createSpinner,
  renderReport,
  renderDiff,
  renderFixSummary,
  renderPolishSummary,
  renderFileBreakdown,
  promptForFix,
  promptForPolish,
  renderMessage,
  renderOutro,
} from './cli/interface.js';

async function main(): Promise<void> {
  const { config, targetDir, action } = await loadConfig(process.argv.slice(2));

  // --- Special actions ---
  if (action === 'help') { renderHelp(); process.exit(0); }
  if (action === 'version') { console.log(`code-debloater v${VERSION}`); process.exit(0); }
  if (action === 'init') {
    renderIntro();
    await renderInitConfig(targetDir);
    renderOutro('config created! edit .code-debloaterrc to tweak defaults.');
    process.exit(0);
  }

  const s = createSpinner();
  const startTime = Date.now();
  renderIntro();

  // --- Step 1: Crawl ---
  s.start('crawling project files...');
  const files = await crawlDirectory(targetDir, config.exclude, config.respectGitignore);

  if (files.length === 0) {
    s.stop('no js/ts files found.');
    renderOutro('nothing to scan.');
    process.exit(0);
  }

  s.message(`scanning ${files.length} files...`);

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

  s.stop('scan complete.');

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
        `  📏 ${shortenPath(b.filePath)}:${b.line} — ${b.name}() is ${b.lines} lines (limit: ${config.maxFunctionLines})`,
        'warn',
      );
    }
  }

  if (config.verbose) {
    renderFileBreakdown(allCommentIssues, duplicateClusters);
  }

  // --- JSON/CSV output ---
  if (config.outputFormat === 'json') {
    const json = renderJsonReport(allCommentIssues, duplicateClusters, summary, null, scanMeta);
    if (config.outputFile) {
      const { writeFile } = await import('fs/promises');
      await writeFile(config.outputFile, json, 'utf-8');
      renderMessage(`report written to ${config.outputFile}`, 'success');
    } else {
      console.log(json);
    }
    process.exit(summary.severity === 'critical' ? 1 : 0);
  }

  const hasIssues = allCommentIssues.length > 0 || duplicateClusters.length > 0;

  if (!hasIssues && !config.polish) {
    renderOutro('zero bloat — pristine!');
    process.exit(0);
  }

  if (config.scanOnly) {
    renderMessage('scan complete. run without --scan-only to auto-fix.', 'info');
    renderOutro('audit finished.');
    process.exit(summary.severity === 'high' || summary.severity === 'critical' ? 1 : 0);
  }

  // --- Step 5: Load NIM config ---
  let nimConfig: NIMConfig;
  try {
    nimConfig = loadNimConfig();
    if (config.model) nimConfig.model = config.model;
  } catch (err) {
    renderMessage(
      err instanceof Error ? err.message : 'failed to load nvidia nim config',
      'error',
    );
    process.exit(1);
  }

  if (config.dryRun) {
    renderMessage('🔍 dry run — no files will be modified.', 'warn');
  }

  // --- Step 6: Fix placeholders ---
  const placeholderItems = allCommentIssues.map((issue) => ({
    path: issue.filePath,
    line: issue.line,
    text: issue.text,
  }));

  let fixResults: Awaited<ReturnType<typeof runFixes>> = [];

  if (placeholderItems.length > 0) {
    const shouldFix = config.autoFix ? true : await promptForFix(nimConfig.model);

    if (shouldFix) {
      s.start(`fixing ${placeholderItems.length} placeholders via ${nimConfig.model}...`);

      fixResults = await runFixes(placeholderItems, nimConfig, config.dryRun, config.maxConcurrent, (done, total, current) => {
        s.message(`fixing placeholders (${done}/${total}) — ${current}`);
      });

      s.stop('placeholder fixes complete.');

      if (config.dryRun) {
        for (const r of fixResults) {
          if (r.status === 'skipped' && r.originalContent && r.newContent) {
            renderDiff(r.filePath, r.originalContent, r.newContent);
          }
        }
      }

      renderFixSummary(fixResults);
    } else {
      renderMessage('no placeholder fixes applied.', 'info');
    }
  }

  // --- Step 7: Analyze duplicates ---
  if (duplicateClusters.length > 0) {
    s.start('analyzing duplicate logic...');

    for (let i = 0; i < duplicateClusters.length; i++) {
      const cluster = duplicateClusters[i];
      if (cluster.length < 2) continue;

      const fn1 = cluster[0];
      const fn2 = cluster[1];

      s.message(`analyzing duplicate cluster #${i + 1}...`);

      try {
        const strategy = await analyzeDuplicateCluster(
          { filePath: fn1.filePath, line: fn1.line, name: fn1.name },
          { filePath: fn2.filePath, line: fn2.line, name: fn2.name },
          nimConfig,
        );
        renderMessage(`\n📐 refactor strategy — cluster #${i + 1}:${strategy}`, 'info');
      } catch (err) {
        renderMessage(
          `  ❌ analysis failed for cluster #${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    }

    s.stop('duplicate analysis complete.');
  }

  // --- Step 8: Polish pass (code quality improvement) ---
  if (config.polish) {
    // Collect all unique files that have any kind of issue
    const flaggedFiles = new Set<string>();

    for (const issue of allCommentIssues) flaggedFiles.add(issue.filePath);
    for (const cluster of duplicateClusters) {
      for (const fn of cluster) flaggedFiles.add(fn.filePath);
    }
    for (const bloat of allBloatIssues) flaggedFiles.add(bloat.filePath);

    // If there were placeholder fixes, add those files too (they may have been rewritten)
    for (const r of fixResults) {
      if (r.status === 'fixed' || r.status === 'skipped') flaggedFiles.add(r.filePath);
    }

    const flaggedList = [...flaggedFiles].sort();

    if (flaggedList.length > 0) {
      const shouldPolish = config.autoFix ? true : await promptForPolish();

      if (shouldPolish) {
        s.message(`polishing ${flaggedList.length} files...`);
        s.start('running deep code quality improvement pass...');

        const polishResults = await runPolish(
          flaggedList,
          nimConfig,
          config.dryRun,
          config.maxConcurrent,
          (done, total, current) => {
            s.message(`polishing code (${done}/${total}) — ${current}`);
          },
        );

        s.stop('polish pass complete.');

        // Render diffs in dry-run mode
        if (config.dryRun) {
          for (const r of polishResults) {
            if (r.status === 'improved') {
              renderDiff(r.filePath, r.originalContent, r.newContent);
            }
          }
        }

        renderPolishSummary(polishResults);

        // Show per-file improvement details
        const improved = polishResults.filter((r) => r.status === 'improved');
        if (improved.length > 0 && config.verbose) {
          renderMessage(`\n  files improved:`, 'info');
          for (const r of improved) {
            renderMessage(`  ✓ ${shortenPath(r.filePath)}`, 'success');
          }
          console.log();
        }
      } else {
        renderMessage('polish pass skipped.', 'info');
      }
    } else {
      renderMessage('no files flagged — nothing to polish.', 'info');
    }
  }

  // --- Done ---
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  renderMessage(`completed in ${totalTime}s across ${files.length} files.`, 'success');
  renderOutro('leaner, meaner, cleaner!');
}

function shortenPath(fp: string): string {
  return fp.split('/').slice(-3).join('/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});