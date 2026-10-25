# CLAUDE.md — Metadata Auto Classifier

> Git strategy, branch naming, commit convention, and release management are defined in the **root CLAUDE.md**. This file covers plugin-specific details only.

## Project Overview

Obsidian plugin: AI-powered automatic metadata classification and generation. Automatically classifies and generates note frontmatter via AI providers.

- Entry: `src/main.ts` → `AutoClassifierPlugin extends Plugin`
- Package manager: **pnpm** (do NOT use npm or yarn)

## Build & Dev Commands

```bash
pnpm run dev            # vault selection + esbuild watch + hot reload
pnpm run dev:build      # esbuild watch only (no vault)
pnpm run build          # tsc type-check + esbuild production (single-shot)
pnpm run test           # Vitest unit tests
pnpm run test:watch     # Vitest watch mode
pnpm run lint           # ESLint (flat config v9)
pnpm run lint:fix       # ESLint auto-fix
pnpm run ci             # build + lint + test
pnpm run release:patch  # run CI → patch bump → auto-push tag
pnpm run release:minor  # run CI → minor bump → auto-push tag
pnpm run release:major  # run CI → major bump → auto-push tag
```

## Architecture (4-module boundary)

```
src/
├── provider/     # Pure API layer (HTTP, OAuth, prompt generation)
├── classifier/   # Business logic (ClassificationService, CommandService)
├── settings/     # UI layer (settings tabs, modals, components)
├── lib/          # Pure utilities (frontmatter, sanitizer, ErrorHandler)
└── main.ts       # Plugin entry point
```

**ESLint boundary rules enforced**:
- `settings` cannot import from `provider` directly
- `provider` cannot import from `settings` or `classifier`
- `lib` cannot import from any domain module
- `classifier` can orchestrate across `provider` + `lib` + `settings`

## Testing

- Framework: Vitest
- Test location: `__tests__/` (mirrors src/ structure)
- Config: `vitest.config.ts`

## TypeScript Path Aliases

```
main       → src/main
provider   → src/provider/index
lib        → src/lib/index
settings   → src/settings/index
classifier → src/classifier/index
```

## Tooling

- ESLint flat config v9 + `eslint-plugin-boundaries` + `eslint-plugin-sonarjs`
- Prettier (2 spaces, semicolons, trailing commas)
- Husky pre-commit → lint-staged (changed .ts files only)
- `boiler.config.mjs` — configures dev deploy (copy mode), version staging (`manifest.json`, `versions.json`), and release artifact packaging

## Release

1. `pnpm run ci` — MUST pass (build + lint + test)
2. `pnpm release:patch|minor|major` — run CI → version bump → auto-push tag
3. GitHub Actions handles CI + Release workflows

**DENIED by settings.json:** `git tag`, `git push --tags`, `gh release` — only `pnpm release:*` is allowed.
