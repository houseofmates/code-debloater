---
name: code-debloater
description: Use code-debloater (NVIDIA NIM-powered AST bloat scanner) to detect duplicate logic, placeholder/TODO comments, AI-generated stubs, and oversized functions in JS/TS codebases, then auto-fix them via DeepSeek V4 Pro.
version: "1.0"
author: hermes
---

# code-debloater skill

## overview

`code-debloater` is a cli tool forked from `zenapta/bloathunter`. it scans javascript/typescript codebases using the typescript compiler api for:

- **structural duplicates** — functions with identical ast bodies (variable names and literals normalized away)
- **placeholder/todo comments** — 30+ patterns for lazy stubs, ai-generated code, "insert logic here", etc.
- **oversized functions** — functions exceeding a configurable line limit

it then auto-fixes placeholders via nvidia nim (deepseek v4 pro) and generates refactoring strategies for duplicate clusters.

## prerequisites

- `nvidia_api_key` env var (get from https://integrate.nvidia.com)
- node 18+
- the package is published on npm as `code-debloater`

## installation

```bash
# run directly (no install needed)
npx code-debloater

# or install globally
npm install -g code-debloater
```

## usage patterns

### 1. quick scan (audit only)

```bash
code-debloater --scan-only ./path/to/project
```

use this when you just want to see what's wrong without fixing anything. exits with code 0 if clean, 1 if issues found.

### 2. full scan + auto-fix

```bash
export NVIDIA_API_KEY=nvapi-...
code-debloater ./path/to/project
```

interactively prompts before applying fixes. use `--yes` to skip the prompt.

### 3. ci pipeline integration

```bash
code-debloater --json --output bloat-report.json ./src
```

produces structured json. exits non-zero on high/critical severity — fail the ci step.

### 4. dry run with diffs

```bash
code-debloater --dry-run --verbose ./src
```

shows colored unified diffs of every change that would be made. no files touched.

### 5. unattended fix (cron / automation)

```bash
code-debloater --yes --max-concurrent 5 ./src
```

skips the confirmation prompt, runs up to 5 parallel nim requests.

### 6. deep code quality improvement (--polish)

```bash
code-debloater --polish --dry-run ./src     # preview improvements
code-debloater --polish --yes ./src          # auto-improve flagged files
```

sends every file that had any issue (placeholder, duplicate, bloat) to deepseek v4 pro for a full code quality pass. the model:
- adds missing type annotations (ts)
- improves variable/function naming
- reduces nesting with early returns / guard clauses
- extracts repeated expressions into helpers
- uses modern syntax (optional chaining, nullish coalescing)
- adds basic error handling for obvious failure points
- removes dead or commented-out code
- simplifies complex conditionals

prompts separately from placeholder fixes — you control each phase.

```bash
# full pipeline: scan → fix placeholders → polish code
code-debloater --polish --yes --max-concurrent 5 ./src
```

### 7. per-project config

```bash
code-debloater --init   # creates .code-debloaterrc in current dir
```

edit `.code-debloaterrc` to set default exclude patterns, model, thresholds:

```json
{
  "exclude": ["test/**", "**/*.spec.ts", "vendor/**"],
  "maxConcurrent": 3,
  "respectGitignore": true,
  "maxFunctionLines": 80
}
```

## all flags

| flag | alias | description |
|------|-------|-------------|
| `--dry-run` | `--dry` | preview fixes with colored diffs |
| `--polish` | `--improve` | deep code quality improvement pass on flagged files |
| `--scan-only` | `--no-fix` | audit only, no ai fixes |
| `--yes` | `-y` | non-interactive auto-fix |
| `--verbose` | `-v` | per-file breakdown |
| `--json` | | structured json output |
| `--output` | `-o` | write report to file |
| `--exclude` | `-x` | glob patterns (comma-sep) |
| `--model` | `-m` | nim model override |
| `--max-concurrent` | | parallel requests (default 3) |
| `--threshold` | | min health score to report |
| `--max-function-lines` | | warn on functions over n lines (default 60) |
| `--init` | | scaffold .code-debloaterrc |
| `--version` | | print version |
| `--help` | `-h` | show help |

## reading the report

the scan produces:

- **health score** (0-100) with letter grade (a-f)
- **severity**: low / medium / high / critical
- **per-file breakdown** in verbose mode — shows `p:3` (3 placeholders), `d:2` (2 duplicate refs), `t:1` (1 todo)
- **recommended actions** — bullet list of what to address first

## env vars

| var | purpose |
|-----|---------|
| `nvidia_api_key` | **required** — nvidia nim auth |
| `code_debloater_model` | model override (same as `--model`) |

## common workflows for hermes

### scanning a repo you just cloned

```bash
cd /path/to/repo && code-debloater --scan-only --verbose
```

if issues are manageable, run the fix:

```bash
code-debloater --yes --max-concurrent 3
```

### integrating into a maintenance cron

use the `--yes` and `--json` flags for automated runs:

```bash
code-debloater --yes --json --output /tmp/bloat-report.json /path/to/project
```

### performance tuning

- for large codebases (500+ files), increase `--max-concurrent` to 5-8
- use `--exclude` to skip generated dirs like `dist/`, `build/`, `coverage/`
- `.code-debloaterrc` at the project root auto-loads, so you don't need to pass flags every time

## pitfalls

- **nim rate limits** — the free tier has rate limits. retry logic handles 429s automatically with exponential backoff, but very large batches (>20 fixes) may still hit limits. use `--max-concurrent 2` for conservative usage.
- **false positives on "placeholder"** — the word "placeholder" in any context (including jsdoc descriptions) triggers detection. this is intentional — it catches real lazy comments but may flag documentation. review dry-run diffs before applying.
- **short anonymous functions** — very short arrow functions with identical structure (e.g., `x => x.status`) may be flagged as duplicates. this is an inherent limitation of ast normalization on tiny bodies.
- **nvidia api key required** — the tool cannot function without `nvidia_api_key`. no fallback to local models.
- **typescript is a runtime dep** — the ast scanners import typescript directly. if running from npx, the first run downloads ts automatically.

## verification

after a fix run, re-scan to confirm issues resolved:

```bash
code-debloater --scan-only
```

the health score should have improved. iterate on clusters the tool couldn't auto-fix (duplicates only get strategies, not auto-merges).

## where the code lives

- repo: `github.com/houseofmates/code-debloater`
- npm: `code-debloater`
- local dev copy: `~/code-debloater`