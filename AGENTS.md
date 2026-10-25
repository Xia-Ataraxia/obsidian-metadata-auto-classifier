<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# Metadata-Auto-Classifier

## Purpose
Metadata Auto Classifier — Obsidian plugin that uses AI (OpenAI/Gemini/Ollama/etc.) to automatically classify and apply frontmatter metadata to notes. Supports multiple LLM providers via a unified adapter, configurable classification prompts, and preset-based metadata templates.

## Key Files

| File | Description |
|------|-------------|
| `src/main.ts` | Composition root — MetadataAutoClassifierPlugin, commands, settings |
| `src/domain/constants.ts` | Plugin-wide constants |
| `src/domain/prompt.ts` | Prompt builder — constructs LLM classification request |
| `src/domain/presets.json` | Built-in metadata classification presets |
| `src/domain/auth/` | API key management and validation |
| `src/ui/ClassificationService.ts` | Orchestrates LLM request → frontmatter write pipeline |
| `src/ui/CommandService.ts` | Registers Obsidian commands (classify active note, batch classify) |
| `src/ui/UnifiedProvider.ts` | Unified LLM provider interface (OpenAI/Gemini/Ollama/etc.) |
| `src/ui/provider-api.ts` | HTTP adapter for provider REST APIs (uses `requestUrl`) |
| `src/ui/frontmatter.ts` | Read/write note frontmatter via Obsidian MetadataCache |
| `src/ui/request.ts` | Request builder and response parser |
| `src/ui/settings/` | Settings tab — provider selection, API keys, prompt templates |
| `src/ui/index.ts` | UI barrel export |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Source layers (see `src/AGENTS.md`) |
| `src/domain/` | Business logic — NO obsidian imports (see `src/domain/AGENTS.md`) |
| `src/domain/auth/` | API key storage and validation (see `src/domain/auth/AGENTS.md`) |
| `src/ui/` | Obsidian-dependent services, provider adapters, frontmatter, settings (see `src/ui/AGENTS.md`) |
| `src/ui/settings/` | Settings tab components (see `src/ui/settings/AGENTS.md`) |
| `src/types/` | Pure type definitions (see `src/types/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- 4-layer architecture: `domain/` must not import `obsidian`
- `UnifiedProvider.ts` is the extension point for new LLM providers — add there, not in services
- `isDesktopOnly: false` — use `requestUrl` (Obsidian API), not `fetch` or Node `http`
- this repo keeps implementation local; do not reintroduce a default `src/shared/` implementation surface

### Testing Requirements
```bash
pnpm run ci     # build + lint + test
pnpm run lint   # ESLint — 0 errors required
```

### Common Patterns
- Adding a new LLM provider: implement the provider interface in `UnifiedProvider.ts`, add auth config in `domain/auth/`
- Classification flow: `CommandService` → `ClassificationService` → `UnifiedProvider` → `frontmatter.ts`

## Dependencies

### Internal
- workspace contract docs define shared surfaces; this repo keeps implementation local by default

### External
- `obsidian` — Obsidian Plugin API
- OpenAI / Gemini / Ollama APIs — via configurable provider
