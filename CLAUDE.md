# CLAUDE.md — Metadata Auto Classifier

Obsidian plugin (`metadata-auto-classifier`): AI-powered frontmatter classification. Entry: `src/main.ts` → `AutoClassifierPlugin`. Repo/package name: `obsidian-metadata-auto-classifier`. Root `AGENTS.md` rules apply.

## Commands (Bun only)

```bash
bun install
bun run dev        # esbuild watch -> dist/
bun run build      # production build -> dist/ (main.js, manifest.json, styles.css)
bun run ci         # build + typecheck + lint + test
bun run release    # central release script (CI-only; never run locally)
```

CI/release are thin callers of `GoBeromsu/obsidian-boiler-template` reusable workflows. Required check: `ci / report`.

## Architecture

```
src/
├── domain/   # pure: constants, presets, prompt, settings migration, auth (pkce, token-manager)
├── types/    # shared types
├── utils/    # pure helpers: logger, redaction, sanitizer, ErrorHandler
├── ui/       # Obsidian-facing: services, providers/requests, OAuth, notices, settings tab + modals
└── main.ts   # lifecycle and wiring
```

`domain/`, `types/`, `utils/` must not import `obsidian` (lint-enforced).

## Gotchas

- Tests live in `__tests__/` (Vitest, node env).
- `manifest.json` `minAppVersion` is 1.5.7 (`getFrontMatterInfo`). Never change the manifest `id`.
- Settings tab exposes `getSettingDefinitions()` (Obsidian 1.13+) with render rows that mount the imperative sections; `display()` remains for older versions.
- Node `http`/`https` are loaded via `require` behind `Platform.isDesktop` (OAuth callback server, Codex streaming).
- Destructive confirmations use `confirmAction` (`src/ui/settings/modals/ConfirmModal.ts`), not `confirm()`.
