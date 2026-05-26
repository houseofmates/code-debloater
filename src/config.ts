import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'node:path';

export interface CodeDebloaterConfig {
  model: string;
  exclude: string[];
  outputFormat: 'pretty' | 'json';
  outputFile: string;
  dryRun: boolean;
  scanOnly: boolean;
  polish: boolean;
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
  polish: false,
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
      case '--polish':
      case '--improve':
        flags.polish = true;
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

  // CLI booleans override config file
  if (cliFlags.dryRun !== undefined) merged.dryRun = cliFlags.dryRun;
  if (cliFlags.scanOnly !== undefined) merged.scanOnly = cliFlags.scanOnly;
  if (cliFlags.polish !== undefined) merged.polish = cliFlags.polish;
  if (cliFlags.verbose !== undefined) merged.verbose = cliFlags.verbose;
  if (cliFlags.autoFix !== undefined) merged.autoFix = cliFlags.autoFix;

  // Environment overrides
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

  for (const p of positional) {
    if (p === '__INIT__') return { config: DEFAULTS, targetDir: '.', action: 'init' };
    if (p === '__VERSION__') return { config: DEFAULTS, targetDir: '.', action: 'version' };
    if (p === '__HELP__') return { config: DEFAULTS, targetDir: '.', action: 'help' };
  }

  let fileConfig: Partial<CodeDebloaterConfig> = {};
  const searchPaths = [
    join(targetDir, '.code-debloaterrc'),
    join(targetDir, '.code-debloaterrc.json'),
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
  code-debloater  —  ast-driven code-bloat scanner + nvidia nim auto-fixer

  usage:
    code-debloater [options] [directory]

  options:
    --dry-run, --dry          preview fixes without writing
    --scan-only, --no-fix     audit only; skip ai fixes
    --polish, --improve       deep code quality improvement pass
    --yes, -y                 non-interactive auto-fix
    --verbose, -v             detailed per-file progress
    --json                    structured json output (ci)
    --output, -o <file>       write results to file
    --exclude, -x <patterns>  glob exclude patterns (comma-sep)
    --model, -m <name>        nim model (default: deepseek-ai/deepseek-v4-pro)
    --max-concurrent <n>      parallel nim requests (default: 3)
    --threshold <n>           minimum health score (0-100)
    --max-function-lines <n>  warn on functions over n lines (default: 60)
    --init                    scaffold .code-debloaterrc
    --version                 print version
    --help, -h                show this help

  environment:
    nvidia_api_key            required. get yours at https://integrate.nvidia.com
    code_debloater_model      model override (same as --model)

  config file (auto-loaded):
    .code-debloaterrc          project-specific settings (json)

  examples:
    code-debloater                              # scan current dir
    code-debloater --scan-only ./src             # audit only
    code-debloater --polish --dry-run ./src      # preview code improvements
    code-debloater --polish --yes ./src          # auto-improve code quality
    code-debloater --json --output report.json   # ci report
    code-debloater --exclude "test/**"           # skip test dirs
    code-debloater --yes --max-concurrent 5      # fast unattended fixes
`);
}

export const VERSION = '1.0.3';

export async function renderInitConfig(targetDir: string): Promise<void> {
  const config = {
    exclude: ['test/**', '**/*.spec.ts', '**/*.test.ts', 'vendor/**', 'dist/**', 'build/**'],
    maxConcurrent: 3,
    respectGitignore: true,
    maxFunctionLines: 60,
  };

  const path = join(targetDir, '.code-debloaterrc');
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`  ✓ created ${path}`);
  console.log(`  edit it to tweak defaults for this project.\n`);
}