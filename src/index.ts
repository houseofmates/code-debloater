#!/usr/bin/env node

import process from 'process';
import { parseArgs } from 'util';
import { crawlDirectory } from './core/crawler.js';
import { scanComments, type CommentIssue } from './core/scanners/commentScanner.js';
import { extractFunctions, findDuplicates, type FunctionInfo } from './core/scanners/astScanner.js';
import { calculateAuditSummary } from './core/issueScorer.js';
import { loadConfig, fixPlaceholder, analyzeDuplicate, type NIMConfig } from './ai/nimConnector.js';
import {
  renderIntro,
  createSpinner,
  renderReport,
  promptForFix,
  renderMessage,
  renderOutro,
} from './cli/interface.js';

interface CliOptions {
  dryRun: boolean;
  model: string;
  targetDir: string;
  noFix: boolean;
  verbose: boolean;
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);

  let dryRun = false;
  let noFix = false;
  let verbose = false;
  let model = '';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
      case '--dry':
        dryRun = true;
        break;
      case '--no-fix':
      case '--scan-only':
        noFix = true;
        break;
      case '--verbose':
      case '-v':
        verbose = true;
        break;
      case '--model':
      case '-m':
        model = args[++i] || '';
        break;
      case '--help':
      case '-h':
        renderHelp();
        process.exit(0);
      default:
        if (!args[i].startsWith('-')) {
          positional.push(args[i]);
        }
    }
  }

  return {
    dryRun,
    model,
    targetDir: positional[0] || process.cwd(),
    noFix,
    verbose,
  };
}

function renderHelp(): void {
  console.log(`
  code-debloater  —  AST-driven bloat scanner + NVIDIA NIM auto-fixer

  Usage:
    code-debloater [options] [directory]

  Options:
    --dry-run, --dry    Show what would be fixed without writing changes
    --no-fix, --scan-only  Scan only; don't prompt for AI fixes
    --model, -m <name>  NVIDIA NIM model override (default: deepseek-ai/deepseek-v4-pro)
    --verbose, -v       Show detailed per-file progress
    --help, -h          Show this help

  Environment:
    NVIDIA_API_KEY        Required. Get yours from https://integrate.nvidia.com
    CODE_DEBLOATER_MODEL  Optional. Override the model (same as --model)

  Examples:
    code-debloater                       # Scan current directory
    code-debloater ./src                 # Scan specific directory
    code-debloater --dry-run ./src       # Dry run
    code-debloater --model nvidia/nvidia-nemotron-super-49b-v1  # Use a different NIM model
`);
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const s = createSpinner();

  renderIntro();

  let config: NIMConfig | null = null;
  if (!options.noFix) {
    try {
      config = loadConfig();
      if (options.model) {
        config.model = options.model;
      }
    } catch {
      // Will check later when user wants to fix
    }
  }

  // --- STEP 1 & 2: Crawl and Scan ---
  s.start('Crawling project files...');
  const files = await crawlDirectory(options.targetDir);

  if (files.length === 0) {
    s.stop('No valid JS/TS files found.');
    renderOutro('Nothing to scan.');
    process.exit(0);
  }

  s.message(`Scanning ${files.length} files for bloat and placeholders...`);

  const allCommentIssues: CommentIssue[] = [];
  let allFunctions: FunctionInfo[] = [];

  // Process files in parallel
  await Promise.all(
    files.map(async (file) => {
      const [comments, funcs] = await Promise.all([
        scanComments(file),
        extractFunctions(file),
      ]);
      allCommentIssues.push(...comments);
      allFunctions = allFunctions.concat(funcs);
    }),
  );

  // --- STEP 3: Deep Audit (AST Duplicates) ---
  const duplicateClusters = findDuplicates(allFunctions);
  const summary = calculateAuditSummary(allCommentIssues, duplicateClusters);

  s.stop('Scan complete!');

  // --- STEP 4: Report ---
  renderReport(allCommentIssues, duplicateClusters, summary, options.verbose);

  if (allCommentIssues.length === 0 && duplicateClusters.length === 0) {
    renderOutro('Zero bloat found. Your codebase is pristine!');
    process.exit(0);
  }

  if (options.noFix) {
    renderMessage('Scan complete. Use without --no-fix to run AI-powered fixes.', 'info');
    renderOutro('Run code-debloater again without --scan-only to auto-fix.');
    process.exit(0);
  }

  // --- STEP 5: Check config (NVIDIA API key) ---
  if (!config) {
    renderMessage(
      'NVIDIA_API_KEY not set. Set it to enable AI-powered fixes:\n' +
        '  export NVIDIA_API_KEY=nvapi-...\n' +
        'Get your key from https://integrate.nvidia.com',
      'error',
    );
    renderOutro('Fix aborted — missing API key.');
    process.exit(1);
  }

  // --- STEP 6: Fix prompt ---
  const wantsFix = await promptForFix(config.model);

  if (!wantsFix) {
    renderMessage('No fixes applied.', 'info');
    renderOutro('Run again anytime to fix issues.');
    process.exit(0);
  }

  if (options.dryRun) {
    renderMessage('🔍 DRY RUN — no files will be modified.', 'info');
  }

  // --- STEP 7: Execute fixes ---
  s.start('Fixing placeholders with NVIDIA NIM (DeepSeek V4 Pro)...');
  let fixCount = 0;
  let errorCount = 0;

  for (const issue of allCommentIssues) {
    const shortPath = issue.filePath.split('/').pop() || issue.filePath;
    s.message(`Fixing placeholder in ${shortPath}...`);

    if (options.verbose) {
      renderMessage(`  ${issue.filePath}:${issue.line} — ${issue.text.slice(0, 60)}`, 'info');
    }

    if (!options.dryRun) {
      try {
        const updated = await fixPlaceholder(issue.filePath, issue.line, issue.text, config);
        // Write is handled inside fixPlaceholder — but we refactored to return
        // the content so we control the write. Let's write it here.
        const { writeFile } = await import('fs/promises');
        await writeFile(issue.filePath, updated, 'utf-8');
        fixCount++;
        renderMessage(`  ✅ Fixed placeholder in ${issue.filePath}`, 'success');
      } catch (err) {
        errorCount++;
        renderMessage(
          `  ❌ Failed to fix ${issue.filePath}:${issue.line} — ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    } else {
      fixCount++;
      renderMessage(`  [DRY RUN] Would fix ${issue.filePath}:${issue.line}`, 'info');
    }
  }

  s.stop(options.dryRun ? 'Dry-run placeholder analysis complete.' : 'Placeholder fixes complete.');

  // --- STEP 8: Duplicate refactoring strategies ---
  if (duplicateClusters.length > 0) {
    s.start('Analyzing duplicate logic clusters...');

    // We need to read the actual source to send as context
    const { readFile } = await import('fs/promises');

    for (let i = 0; i < duplicateClusters.length; i++) {
      const cluster = duplicateClusters[i];
      if (cluster.length < 2) continue;

      const fn1 = cluster[0];
      const fn2 = cluster[1];

      s.message(`Analyzing duplicate cluster #${i + 1}...`);

      if (options.verbose) {
        renderMessage(
          `  Cluster #${i + 1}: ${fn1.name}() in ${fn1.filePath} ↔ ${fn2.name}() in ${fn2.filePath}`,
          'info',
        );
      }

      if (!options.dryRun) {
        try {
          // Read surrounding context for better analysis
          const content1 = await readFile(fn1.filePath, 'utf-8');
          const content2 = await readFile(fn2.filePath, 'utf-8');
          // Extract just the function lines (roughly — we don't have precise ranges,
          // so send the function names for the model to locate)
          const context1 = content1.slice(
            Math.max(0, fn1.line - 5),
            fn1.line + 30,
          );
          const context2 = content2.slice(
            Math.max(0, fn2.line - 5),
            fn2.line + 30,
          );

          const strategy = await analyzeDuplicate(
            fn1.filePath,
            fn1.line,
            fn1.name,
            context1,
            fn2.filePath,
            fn2.line,
            fn2.name,
            context2,
            config,
          );

          renderMessage(`\n📐 Refactor Strategy — Cluster #${i + 1}:${strategy}`, 'info');
        } catch (err) {
          errorCount++;
          renderMessage(
            `  ❌ Failed to analyze duplicate cluster #${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          );
        }
      } else {
        renderMessage(
          `  [DRY RUN] Would analyze: ${fn1.name}() ↔ ${fn2.name}()`,
          'info',
        );
      }
    }

    s.stop('Duplicate analysis complete.');
  }

  // --- Summary ---
  if (options.dryRun) {
    renderMessage(
      `Dry run complete: ${fixCount} placeholders would be fixed, ${duplicateClusters.length} duplicate clusters would be analyzed.`,
      'success',
    );
  } else if (fixCount > 0 || errorCount > 0) {
    renderMessage(
      `${fixCount} placeholders fixed, ${duplicateClusters.length} duplicate clusters analyzed, ${errorCount} errors.`,
      'success',
    );
  }

  renderOutro('Your code is now leaner and meaner!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
