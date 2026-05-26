import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'node:path';

export interface CodeDebloaterConfig {
  model: string;
  exclude: string[];
  outputFormat: 'pretty' | 'json';
  outputFile: string;
  dryRun: boolean;
  scanOnly: boolean;
  verbose: boolean;
  maxConcurrent: number;
  threshold: number;
  respectGitignore: boolean;
  autoFix: boolean;
  maxFunctionLines: number;
}

export const DEFAULTS: CodeDebloaterConfig = {
  model: 'deepseek-ai/deepseek-v4-pro',
  exclude: [],
  outputFormat: 'pretty',
  outputFile: '',
  dryRun: false,
  scanOnly: false,
  verbose: false,
  maxConcurrent: 3,
  threshold: 0,
  respectGitignore: true,
  autoFix: false,
  maxFunctionLines: 60,
};

async function tryReadConfig(path: string): Promise<Partial<CodeDebloaterConfig> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface CliResult {
  flags: Partial<CodeDebloaterConfig>;
  targetDir: string;
  positional: string[];
}

function parseArgs(argv: string[]): CliResult {
  const flags: Partial<CodeDebloaterConfig> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
      case '--dry':
        flags.dryRun = true;
        break;
      case '--scan-only':
      case '--no-fix':
        flags.scanOnly = true;
        break;
      case '--verbose':
      case '-v':
        flags.verbose = true;
        break;
      case '--json':
        flags.outputFormat = 'json';
        break;
      case '--output':
      case '-o':
        flags.outputFile = argv[++i] || '';
        break;
      case '--exclude':
      case '-x': {
        const val = argv[++i] || '';
        flags.exclude = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--model':
      case '-m':
        flags.model = argv[++i] || DEFAULTS.model;
        break;
      case '--max-concurrent':
        flags.maxConcurrent = parseInt(argv[++i] || '3', 10) || 3;
        break;
      case '--yes':
      case '-y':
        flags.autoFix = true;
        break;
      case '--threshold':
        flags.threshold = parseInt(argv[++i] || '0', 10) || 0;
        break;
      case '--max-function-lines':
        flags.maxFunctionLines = parseInt(argv[++i] || '60', 10) || 60;
        break;
      case '--init':
        flags.dryRun = true; // abuse dry-run flag to signal init
        positional.push('__INIT__');
        break;
      case '--version':
        positional.push('__VERSION__');
        break;
      case '--help':
      case '-h':
        positional.push('__HELP__');
        break;
      default:
        if (!arg.startsWith('-')) positional.push(arg);
    }
  }

  return {
    flags,
    targetDir: positional.find((p) => p !== '__INIT__' && p !== '__VERSION__' && p !== '__HELP__') || '.',
    positional,
  };
}

function mergeConfig(
  config: Partial<CodeDebloaterConfig>,
  cliFlags: Partial<CodeDebloaterConfig>,
): CodeDebloaterConfig {
  const merged = { ...DEFAULTS, ...config, ...cliFlags };

  // CLI flags should override config file for booleans
  // (config file sets true, CLI sets false — CLI wins)
  if (cliFlags.dryRun !== undefined) merged.dryRun = cliFlags.dryRun;
  if (cliFlags.scanOnly !== undefined) merged.scanOnly = cliFlags.scanOnly;
  if (cliFlags.verbose !== undefined) merged.verbose = cliFlags.verbose;
  if (cliFlags.autoFix !== undefined) merged.autoFix = cliFlags.autoFix;

  // Environment overrides
  if (process.env.NVIDIA_API_KEY && !cliFlags.model) {
    // model isn't overridden by API_KEY
  }
  if (process.env.CODE_DEBLOATER_MODEL && !cliFlags.model) {
    merged.model = process.env.CODE_DEBLOATER_MODEL;
  }

  return merged;
}

export async function loadConfig(argv: string[]): Promise<{
  config: CodeDebloaterConfig;
  targetDir: string;
  action: 'scan' | 'init' | 'version' | 'help';
}> {
  const { flags: cliFlags, targetDir, positional } = parseArgs(argv);

  // Handle special actions
  for (const p of positional) {
    if (p === '__INIT__') return { config: DEFAULTS, targetDir: '.', action: 'init' };
    if (p === '__VERSION__') return { config: DEFAULTS, targetDir: '.', action: 'version' };
    if (p === '__HELP__') return { config: DEFAULTS, targetDir: '.', action: 'help' };
  }

  // Try loading config from target dir upward
  let fileConfig: Partial<CodeDebloaterConfig> = {};
  const searchPaths = [
    join(targetDir, '.code-debloaterrc'),
    join(targetDir, '.code-debloaterrc.json'),
    join(targetDir, '.cdeb.json'),
  ];
  for (const p of searchPaths) {
    const found = await tryReadConfig(p);
    if (found) {
      fileConfig = found;
      break;
    }
  }

  const config = mergeConfig(fileConfig, cliFlags);
  return { config, targetDir, action: 'scan' };
}

export function renderHelp(): void {
  console.log(`
  code-debloater  —  AST-driven code-bloat scanner + NVIDIA NIM auto-fixer

  Usage:
    code-debloater [options] [directory]

  Options:
    --dry-run, --dry          Preview fixes without writing changes
    --scan-only, --no-fix     Audit only; skip the AI fix phase
    --yes, -y                 Non-interactive auto-fix (no prompts)
    --verbose, -v             Show detailed per-file progress
    --json                    Output results as JSON (for CI)
    --output, -o <file>       Write results to file
    --exclude, -x <patterns>  Glob patterns to exclude (comma-sep)
    --model, -m <name>        NVIDIA NIM model (default: deepseek-ai/deepseek-v4-pro)
    --max-concurrent <n>      Max parallel NIM requests (default: 3)
    --threshold <n>           Minimum health score to report (0-100)
    --max-function-lines <n>  Warn on functions over N lines (default: 60)
    --init                    Create a .code-debloaterrc config in current dir
    --version                 Print version
    --help, -h                Show this help

  Environment:
    NVIDIA_API_KEY            Required. Get yours from https://integrate.nvidia.com
    CODE_DEBLOATER_MODEL      Model override (same as --model)

  Config file (auto-loaded):
    .code-debloaterrc          Project-specific settings (JSON)

  Examples:
    code-debloater                                    # scan + auto-fix
    code-debloater --scan-only ./src                  # audit only
    code-debloater --dry-run --verbose                # preview with details
    code-debloater --json --output report.json        # CI-friendly output
    code-debloater --exclude "test/**,vendor/**"      # skip test & vendor dirs
    code-debloater --yes --max-concurrent 5           # fast unattended fixes
`);
}

export const VERSION = '1.0.0';

export async function renderInitConfig(targetDir: string): Promise<void> {
  const config = {
    exclude: ['test/**', '**/*.spec.ts', '**/*.test.ts', 'vendor/**', 'dist/**', 'build/**'],
    maxConcurrent: 3,
    respectGitignore: true,
    maxFunctionLines: 60,
  };

  const path = join(targetDir, '.code-debloaterrc');
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`  ✓ Created ${path}`);
  console.log(`  Edit it to tweak defaults for this project.\n`);
}