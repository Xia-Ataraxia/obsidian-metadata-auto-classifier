<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/domain/ — Business Logic Layer

## Purpose

Business logic with NO Obsidian imports. This layer contains typed Jev classification, tag-generation validation, source-preserving YAML edits, authentication constants, and provider configuration.

## Key Files

| File                       | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `jev-questions.ts`         | Typed candidate questions and bounded Jev requests                                         |
| `jev-selection.ts`         | Strict result validation and yes/no/abstain aggregation                                    |
| `tag-generation.ts`        | Exact-tags permission, prompt construction, and strict new-tag validation                  |
| `classification-state.ts`  | Meaningful settings snapshots and explicit operation ownership                             |
| `classification-result.ts` | All-or-nothing selection/generation and combined count policy                              |
| `frontmatter-edit.ts`      | Byte-preserving target YAML range edits                                                    |
| `frontmatter-snapshot.ts`  | Typed target-field baseline comparison                                                     |
| `constants.ts`             | Provider defaults, classification defaults, notice catalog, frontmatter settings           |
| `presets.json`             | Provider presets (OpenAI, Anthropic, Ollama, Gemini) with models and structure definitions |

## Subdirectories

| Directory | Purpose                                                            |
| --------- | ------------------------------------------------------------------ |
| `auth/`   | Token validation, expiry, and fixed device-auth endpoint constants |

## For AI Agents

- **No Obsidian imports** — if you need Obsidian types, define shims in `src/types/` instead
- Keep all functions pure and deterministic
- Unit tests should NOT require mocks (only stubs for simple dependencies)
- Preserve stored user instructions as semantic context; do not sanitize/rewrite templates or add legacy response aliases
- Only exact `tags` with literal boolean opt-in can generate; ordinary fields use Jev candidates
- Operation state owns its mutable token maps explicitly; deactivation is terminal
- Provider configuration is a source-of-truth; update `presets.json` when adding new providers

## Dependencies

- Imports from: `utils/`, `types/` only
- Do NOT import from: `obsidian`, `ui/`, or repo-external shared implementation surfaces
- Exports to: `ui/`, `main.ts`
