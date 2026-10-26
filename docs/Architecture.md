# Architecture

## Principles

- Keep deterministic parsing, selection, generation validation, and source-range editing separate from Obsidian, network, DOM, and storage effects.
- Use explicit typed contracts. Validate external responses as `unknown`; do not accept legacy response aliases or silently downgrade failed inference.
- Preserve user instructions and unrelated note bytes. Do not replace stored templates, serialize an entire YAML document, or introduce a fallback write path.
- Capture operation identity and meaningful settings before inference; revalidate them where the effect happens.
- Error reporting must identify a safe category, not disclose the input that failed. Never log arbitrary exceptions, note text, candidates, responses, credentials, or file paths. Diagnostics use fixed event codes and numeric metrics.
- Keep implementation local to this repository. Barrel files expose named implementations rather than becoming another shared implementation layer.

## Layers

| Layer         | Responsibility                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/`  | Provider, field, settings, and decision contracts                                                                                                    |
| `src/domain/` | Pure decision request construction and decisions, generated-tag validation, YAML range editing and target snapshots, explicit operation-state transitions |
| `src/ui/`     | Obsidian-dependent classification orchestration, native atomic commits, provider adapters, transport, authentication, and settings UI                |
| `src/utils/`  | Repository-local utilities and diagnostic boundary                                                                                                   |
| `src/main.ts` | Composition root, lifecycle, persisted settings, and command entry points                                                                            |

Domain classification and YAML modules must not import Obsidian. The `yaml` library supplies parsing and source ranges; the plugin does not implement a competing YAML parser. Stateful operation tokens have an explicit owner and lifetime rather than an implicit module-global lock.

## Classification modules

| Module                            | Responsibility                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `domain/decision-questions.ts`    | Build stable named yes/no questions and conservatively bounded request chunks                                   |
| `domain/decision-formats.ts`      | Pick the transport per model and map questions to SystemOne, OpenAI Decisions, or chat structured output        |
| `domain/decision-selection.ts`    | Decode each transport, validate exact answer sets and probabilities; distinguish yes, all-no, and abstention    |
| `domain/model-list.ts`            | Resolve classification and generation targets; migrate the 1.13 standalone Jev key to a TypeSafe provider      |
| `domain/tag-generation.ts`        | Exact `tags` permission gate, remaining-slot calculation, generation prompt and strict tag-result validation    |
| `domain/classification-state.ts`  | Related settings snapshots, token ownership, and conflict checks                                                |
| `domain/classification-result.ts` | All-or-nothing selection/generation decisions and combined operation counts                                     |
| `domain/frontmatter-snapshot.ts`  | Typed target-field presence/value snapshots                                                                     |
| `domain/frontmatter-edit.ts`      | Edit only a target YAML source range; reject unsafe or unsupported structures                                   |
| `ui/DecisionClassifier.ts`        | Send all chunks through the model's transport and reject partial or stale results                               |
| `ui/ClassificationService.ts`     | Coordinate preparation, selection, optional generation, and the final guarded commit                            |
| `ui/classification-generation.ts` | Capture only the used provider, guard refresh persistence, and preserve live generation validity                |
| `ui/provider-session.ts`          | Share provider snapshots and awaited, account-bound refresh persistence between generation and connection tests |
| `ui/classification-status.ts`     | Map outcomes and failures to static, disclosure-safe messages                                                   |
| `ui/frontmatter-commit.ts`        | Use native frontmatter boundaries and one synchronous `Vault.process` compare-and-transform                     |
| `ui/frontmatter.ts`               | Collect reference values through metadata APIs and clone field settings for editing                             |

A batch captures one original note. All entry points share the same classification service and per-note/per-field operation ownership. Tab switching does not retarget an in-flight operation; field or file changes, permission revocation, unload, and expiry invalidate its result. Changes to unrelated fields need not invalidate a safe commit.

## Optional generation and transport

`ui/provider-api.ts` exposes explicit model connection testing and permission-gated new-tag generation. `UnifiedProvider` coordinates provider specs in `provider-chat-specs.ts` and `provider-native-specs.ts`. The generation result is only `{ tags: string[] }`; it is not the classification response. `UnifiedProvider.callStructured` also carries the chat-emulated decision schema.

`ui/request.ts` owns JSON or explicit raw-form/native HTTP behavior, safe HTTP errors, and bounded retries. `ui/request-control.ts` shares abort, deadline, and currentness enforcement across inference and authentication. Only explicit 429/529 responses retry, with three total attempts by default; authentication explicitly permits one attempt. Cancellation ignores late native completions rather than claiming physical cancellation of `requestUrl`. `ui/streaming-request.ts` consumes buffered native responses as strict SSE frames and requires successful terminal completion. Neither path uses a Node HTTP fallback. Codex accepts completed output-array terminals and ID-only completion metadata; generated text still comes from accumulated deltas. Contradictory status, error/incomplete metadata, refusals, missing completion, partial frames, empty text, and trailing events fail closed. Live backend compatibility remains unverified.

Authentication is a separate concern from candidate selection. Classification needs only the selected model's credentials. Actual device authentication, mobile runtime validation, and provider service eligibility are separate verification obligations; requestUrl-based inference alone does not prove them.

`ui/auth/device-auth.ts` implements the fixed-host device flow with a 15-minute deadline, cancellable polling, a hosted callback exchange, and single-attempt grants. The dialog renders the code as text and opens the fixed verification URL only on an explicit click. There is no loopback server or local PKCE implementation. Token parsing requires a future access-token expiry and `chatgpt_account_id`; optional ID-token account claims must agree. These decoded claims are routing/expiry hints, not signature verification. Refresh rejects account switches and awaits guarded persistence before retrying; an omitted rotated refresh token preserves the existing token, but an explicitly invalid token does not. One in-flight owner holds each rotating refresh credential through persistence and retry; competing operations fail without replaying that grant.

Sessions carrying credentials whose refresh persistence is pending cannot start or dispatch requests. If persistence fails, only the unchanged credential bundle still owned by that refresh is restored; manual credential edits or provider replacement are never rolled back. This is not a transaction over arbitrary settings writes.

Provider names are exact protocol/profile keys, not arbitrary display labels. Preset selection is the explicit way to change them. New saves require unique supported names, and generation/model operations reject ambiguous existing names without rewriting saved records. Malformed explicit authentication remains malformed through snapshots and fails before dispatch; it cannot expose flat credentials as a fallback. Keyless local requests omit the Authorization header.

## Settings and diagnostics

The named settings tab implementation is `ui/settings/AutoClassifierSettingTab.ts`; `ui/settings/index.ts` is a barrel. One provider/model list serves classification and generation; each model row shows whether it uses a decision API or chat scoring. Native field controls expose generation only for the exact `tags` name, defaulting to false.

Provider editing uses an isolated draft. Saving awaits persistence; newer draft edits remain available for another save, while closing the modal revokes late UI updates. A deliberate disconnect clears credential sources in the draft without requiring a replacement login.

`PluginLogger` admits only closed event codes and finite numeric metrics. It has no arbitrary-error or compatibility logging alias. Shared error notices use static categories; remote exception messages are not user-facing diagnostics.

## Verification

Pure contract tests exercise thresholds, ties, exact response shapes, malformed inputs, tag exclusions, and byte preservation. Orchestration tests exercise concurrency, lifecycle, settings changes, and callback-time revocation. Native isolated tests establish API feasibility separately from mocks. Full CI, independent reviews, real-device checks, and approved protected quality evaluation remain distinct gates.

See [Classification workflow](./Classification-Workflow.md) for the decision and commit sequence.
