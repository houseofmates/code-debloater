# Changelog

## 1.0.1 — 2026-05-26

### Fixed
- Moved `typescript` from devDependencies to dependencies — required at runtime for AST scanning via npx

## 1.0.0 — 2026-05-26

This is a fork of [zenapta/BloatHunter](https://github.com/zenapta/BloatHunter). Full rewrite of the AI backend and major UX/feature expansion.

### Added
- **NVIDIA NIM integration** — replaces Ollama/Llama 3 local models with DeepSeek V4 Pro via `integrate.api.nvidia.com/v1/chat/completions`
- **Config file** — `.code-debloaterrc` (JSON) for project-specific settings
- **`--dry-run` mode** — preview changes without writing files, with colored unified diffs
- **`--json` output** — structured JSON report for CI integration
- **`--output` / `-o`** — write results to a file
- **`--exclude` / `-x`** — glob-based exclude patterns
- **`--yes` / `-y`** — non-interactive mode for unattended runs
- **`--scan-only` / `--no-fix`** — audit-only mode
- **`--verbose` / `-v`** — per-file issue breakdown
- **`--model` / `-m`** — override the NIM model
- **`--max-concurrent`** — parallel NIM request limit
- **`--threshold`** — minimum health score threshold
- **`--init`** — scaffold a `.code-debloaterrc` in the current project
- **`--version`** — print version
- **`.gitignore` support** — respects `.gitignore` patterns automatically
- **Bloat detection** — flags oversized functions exceeding `--max-function-lines`
- **Health bar** — visual ASCII bar for the health score
- **Fix summary** — per-category breakdown after fixes
- **Exit codes** — returns non-zero when severity is high/critical (CI-friendly)
- **Retry logic** — exponential backoff for NIM rate limits and server errors
- **30+ placeholder patterns** — broader detection of AI-generated stubs and lazy comments

### Changed
- Package renamed from `zenapta_bloathunter_cli` to `code-debloater`
- CLI renamed from "BLOATHUNTER" to "CODE-DEBLOATER"
- AI prompts optimized for DeepSeek V4 Pro code generation
- File extension support extended to `.mjs`, `.cjs`, `.mts`, `.cts`
- Shared AST utilities extracted to eliminate self-duplication

### Fixed
- False positives in "placeholder" word detection (improved context awareness)
- Sequential NIM requests → parallel with concurrency control
- No timeout/retry handling → 120s timeout + 3 retries

### Removed
- Ollama dependency (no longer needed)
- Local model requirement (no GPU needed)
