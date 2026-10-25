<!-- Parent: ../AGENTS.md -->

# Metadata-Auto-Classifier

## Purpose

Metadata Auto Classifier uses Jev to select existing metadata candidates. Optional generation providers may create tags only when the exact `tags` field explicitly enables generation. Writes use guarded, byte-preserving native vault operations.

## Key Files

| File                              | Description                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| `src/main.ts`                     | Composition root — MetadataAutoClassifierPlugin, commands, settings |
| `src/domain/constants.ts`         | Plugin-wide constants                                               |
| `src/domain/tag-generation.ts`    | Exact permission, generation prompt, and tag validation             |
| `src/domain/frontmatter-edit.ts`  | Pure, byte-preserving YAML field edits                              |
| `src/domain/presets.json`         | Built-in metadata classification presets                            |
| `src/domain/auth/`                | API key management and validation                                   |
| `src/ui/ClassificationService.ts` | Orchestrates LLM request → frontmatter write pipeline               |
| `src/ui/CommandService.ts`        | Registers Obsidian commands (classify active note, batch classify)  |
| `src/ui/UnifiedProvider.ts`       | Unified LLM provider interface (OpenAI/Gemini/Ollama/etc.)          |
| `src/ui/JevClassifier.ts`         | Jev candidate selection adapter                                     |
| `src/ui/provider-api.ts`          | Explicit model tests and permission-gated tag generation            |
| `src/ui/frontmatter.ts`           | Candidate collection from metadata cache, including inline tags     |
| `src/ui/frontmatter-commit.ts`    | One guarded native `Vault.process` commit                           |
| `src/ui/request.ts`               | Request builder and response parser                                 |
| `src/ui/settings/`                | Settings tab — provider selection, API keys, prompt templates       |
| `src/ui/index.ts`                 | UI barrel export                                                    |

## Subdirectories

| Directory          | Purpose                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `src/`             | Source layers (see `src/AGENTS.md`)                                                            |
| `src/domain/`      | Business logic — NO obsidian imports (see `src/domain/AGENTS.md`)                              |
| `src/domain/auth/` | API key storage and validation (see `src/domain/auth/AGENTS.md`)                               |
| `src/ui/`          | Obsidian-dependent services, provider adapters, frontmatter, settings (see `src/ui/AGENTS.md`) |
| `src/ui/settings/` | Settings tab components (see `src/ui/settings/AGENTS.md`)                                      |
| `src/types/`       | Pure type definitions (see `src/types/AGENTS.md`)                                              |

## For AI Agents

### Working In This Directory

- `domain/`, `types/`, and `utils/` must not import `obsidian`
- `UnifiedProvider.ts` is the extension point for new LLM providers — add there, not in services
- `isDesktopOnly: false` — use `requestUrl` (Obsidian API), not `fetch` or Node `http`
- this repo keeps implementation local; do not reintroduce a default `src/shared/` implementation surface
- Test files in `__tests__/` use Jest-style mocks in `__mocks__/`

### Testing Requirements

Follow the updated parent Bun-only rule. The existing package `ci` script still invokes pnpm; the lockfile/generated CI migration is blocked on identifying its upstream source or an explicit ownership transfer. Do not edit generated copies or claim Bun frozen-install/hosted CI verification from an existing dependency installation.

For the currently installed dependencies:

```bash
bun x --bun --no-install tsc --noEmit
bun x --bun --no-install vitest run
bun x --bun --no-install eslint . --ignore-pattern 'coverage/**' --ignore-pattern '__tests__/**' --ignore-pattern '__mocks__/**'
bun esbuild.config.mjs production
```

Verify runtime changes in the isolated development vault, including `obsidian vault=.dev-vault dev:errors`. Mock tests are not native or mobile certification.

### Common Patterns

- Adding a new LLM provider: implement the provider interface in `UnifiedProvider.ts`, add auth config in `domain/auth/`
- Classification flow: `CommandService` → `ClassificationService` → `JevClassifier` → optional generation → `frontmatter-commit.ts`

## Dependencies

### Internal

- workspace contract docs define shared surfaces; this repo keeps implementation local by default

### External

- `obsidian` — Obsidian Plugin API
- Jev — existing-candidate classification
- Configurable generation providers — exact opt-in only
- `yaml` — document ranges for byte-preserving field edits
