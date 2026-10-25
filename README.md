# Metadata Auto Classifier

Metadata classification for Obsidian using Jev to select existing tags and frontmatter values. New tags can optionally be generated through a separately configured provider.

> The more context you give, the more accurate the classification.

## Example

![Usage Example](./assets/usecase.gif)

## Features

- **Candidate classification** -- Jev selects relevant existing values without inventing categories
- **Optional new tags** -- enable generation explicitly for the exact `tags` field; disabled by default
- **Custom frontmatter fields** -- select values from configured or collected references
- **Classification rules** -- set custom rules, tag categories, and field-specific guidelines for accurate metadata
- **Per-field context prompts** -- provide additional context per metadata field to guide AI classification
- **Source-preserving writes** -- recheck concurrent changes and edit only the target YAML entry
- **Optional generation providers** -- use OpenAI, Gemini, Ollama, or other supported providers for new tags, not ordinary candidate selection

## Installation

### Community Plugin (Recommended)

1. Open Obsidian and navigate to **Settings > Community Plugins**
2. Disable Safe Mode if currently enabled
3. Click **Browse** and search for "Metadata Auto Classifier"
4. Click **Install**, then **Enable** to activate the plugin

### Manual Installation (Beta)

Using [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from the Obsidian Community Plugins browser
2. In BRAT settings, click **Add Beta plugin**
3. Enter the repository URL: `https://github.com/GoBeromsu/Metadata-Auto-Classifier`
4. Click **Add Plugin** to install

![BRAT Installation](./assets/brat-install.gif)

## Usage

Configure the Jev API key and model first. A generation provider is unnecessary unless **Generate new tags** is enabled and additional slots remain.

1. Open any note you want to classify
2. Access commands via the Command Palette (Cmd/Ctrl + P):
   - **Fetch tags using current provider** -- classify existing tags, with optional new-tag generation
   - **Fetch all frontmatter using current provider** -- populate all custom frontmatter fields
   - **Individual field commands** -- update specific frontmatter fields one at a time
3. Review the resulting metadata. Uncertain results, insufficient counts, generation failures, or conflicting edits leave the note unchanged.

## Commands

| Command                                      | Description                                |
| -------------------------------------------- | ------------------------------------------ |
| Fetch tags using current provider            | Classify tags for the captured active note |
| Fetch all frontmatter using current provider | Populate all configured frontmatter fields |
| Fetch [field] using current provider         | Update a specific frontmatter field        |

## Settings

| Setting                     | Description                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Jev API key and model       | Configure candidate classification independently of generation                               |
| Optional provider and model | Configure generation of new tags only                                                        |
| Generate new tags           | Opt in for the exact `tags` field; ordinary fields cannot generate values                    |
| Custom frontmatter fields   | Define candidate fields, references, count limits, append/overwrite, and WikiLink formatting |
| Classification rules        | Set semantic guidance; existing instructions are preserved                                   |
| Field-specific prompts      | Provide per-field context to guide AI output                                                 |

Jev accepts yes probabilities at or above 0.7 and no probabilities at or below 0.3. Zero yes results with any abstention stop without generation or writing. The maximum count limits the current operation, not the total existing values in append mode. See [Classification workflow](./docs/Classification-Workflow.md) for safety and verification boundaries.

### Generation authentication and model limits

- Codex sign-in displays a device code and an explicit link to the official verification page. It does not start a local callback server, automatically open a browser, or copy the code. Closing the dialog cancels the flow.
- OAuth refresh must preserve the account and save current credentials before retrying. Editing the provider or unloading the plugin invalidates an in-flight operation.
- Models must support their provider's required output protocol. DeepSeek uses JSON mode with strict application validation; schema/tool-capable providers use their documented structured-output controls. Unsupported models fail rather than silently changing protocols or models.
- Local Ollama and LM Studio servers may omit API keys; installed models and engine capabilities still matter. Bundled suggestions do not migrate saved models or endpoints and do not guarantee account access, free pricing, or local installation.

Real-account device login, mobile behavior, and live provider compatibility are not yet certified. The retained Codex backend also has unresolved model and streaming-terminal compatibility limits.

## Tech Stack

| Category | Technology                                        |
| -------- | ------------------------------------------------- |
| Platform | Obsidian 1.13.0 or later                          |
| Language | TypeScript 5                                      |
| Bundler  | esbuild                                           |
| AI       | Jev classification; optional generation providers |
| Testing  | Vitest (with coverage)                            |
| Linting  | ESLint 9 (flat config) + Prettier                 |

## Project Structure

```
Metadata-Auto-Classifier/
├── src/
│   ├── main.ts           # Plugin entry point (AutoClassifierPlugin)
│   ├── domain/            # Pure classification, generation, and YAML rules
│   ├── ui/                # Obsidian services, providers, atomic writes, settings
│   ├── types/             # Type contracts
│   └── utils/             # Local utilities and safe diagnostics
├── __tests__/             # Vitest tests (mirrors src/ structure)
├── __mocks__/             # Obsidian API mock
├── scripts/               # dev.mjs, version.mjs, release.mjs
├── boiler.config.mjs      # Per-repo config
└── manifest.json          # Obsidian plugin manifest
```

## Development

```bash
pnpm install
pnpm dev              # vault selection + esbuild watch + hot reload
pnpm build            # tsc type-check + production build
pnpm test             # Vitest unit tests
pnpm test:coverage    # Vitest with coverage report
pnpm lint             # ESLint
pnpm run ci           # build + lint + test
```

## Inspiration

- UI design inspired by [Obsidian Web Clipper](https://obsidian.md/clipper)
- Codex API integration inspired by [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer)

## Support

For questions, issues, or feature requests, please visit the [GitHub repository](https://github.com/GoBeromsu/Metadata-Auto-Classifier).

## License

This project is licensed under the [MIT License](LICENSE).
