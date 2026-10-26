# Classification workflow

## Selection and optional generation

1. A command captures the current note once. Batch commands retain that note even if the active tab changes. A shared per-note/per-field operation token prevents overlapping classification of the same field.
2. The service snapshots the field settings and global instructions. Missing references are collected through Obsidian's metadata cache; concurrent changes are checked before reference settings are saved. Manually configured references are retained.
3. `Vault.cachedRead` supplies the baseline. Native `getFrontMatterInfo` determines boundaries, with a leading BOM retained separately. The body and typed target-field value are captured independently of unrelated frontmatter.
4. Jev receives the note body, field name, and unchanged user instructions as state, with named Noul questions for candidate values. Empty candidates cause no Jev request. Every request chunk must succeed before results are used.
5. A probability at or above **0.7** is a yes; at or below **0.3** is a no. Values between those thresholds are abstentions. Yes results are sorted by probability, with original candidate order breaking ties. Zero yes results plus any abstention stops the operation without generation or writing. All-no and no-candidate outcomes are distinct.
6. New values may be generated only when the actual field name is exactly `tags` and `generateNewTags` is the boolean `true`. The default is false. Other fields always select existing candidates, even if their stored generation flag is true.
7. Generation uses the separately configured optional provider only when slots remain after selection. Zero remaining slots requires no generation provider or credentials. Its only accepted response shape is `{ "tags": ["new/tag"] }`; legacy `output` and `reliability` responses are rejected. Generated values must have valid tag syntax and must not duplicate existing values, candidates, selected values, or one another. Generation failure does not write a partial selection.
8. The combined selection and generation must satisfy the configured minimum and maximum. Uncertain values are never used to fill the minimum. The maximum limits this operation's additions, not the total values already present in append mode.

## Atomic write

`commitField` uses one synchronous `Vault.process` callback. Inside that callback it checks the live operation token, lifecycle, deadline, original file identity and path, relevant settings and permissions, body, and typed target-field baseline.

Unrelated frontmatter changes are allowed. YAML source-range edits preserve unrelated bytes, comments, formatting, BOM, and line endings; only the target entry is replaced or inserted. Unsupported or ambiguous YAML fails closed. No whole-document YAML serialization or `processFrontMatter` fallback is used. WikiLinks are applied once at the final edit boundary.

When native parsing recognizes no frontmatter, the entire original text remains the body and a new header is prepended. This includes an unrecognized opening delimiter: the plugin does not invent a second delimiter parser.

## Transport and privacy

JSON and buffered SSE use Obsidian `requestUrl`, including on mobile. A shared operation deadline is forwarded through requests; explicit 429/529 retries are bounded to three total attempts. Uncertain network failures and timeouts are not replayed. Live validity checks prevent another request after permission revocation during retry backoff. Logical timeout does not claim physical cancellation of an already dispatched native request.

SSE requires valid frames and successful terminal completion. Refusal, incomplete output, malformed responses, and partial streams cannot become a successful generation.

Notices report safe operation outcomes rather than note values, paths, probabilities, response text, or credentials. Diagnostic output is restricted to fixed event codes and finite numeric metrics. Existing user instructions are preserved as semantic context rather than detected, rewritten, or migrated to a new response template.

## Verification boundary

Synthetic tests and isolated desktop API checks do not establish mobile-device compatibility or classification quality on real notes. Paid evaluation, protected-copy evaluation, account authentication, and release/deployment require their separate approvals and evidence.

See [Architecture](./Architecture.md) for module responsibilities.
