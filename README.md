# Metadata Auto Classifier

AI-powered Obsidian plugin that analyzes your notes and generates tags and frontmatter values with a configurable AI provider.

[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%27metadata-auto-classifier%27%5D.downloads&suffix=%20downloads&logo=obsidian&label=Obsidian&color=483699)](https://obsidian.md/plugins?id=metadata-auto-classifier)
[![Latest Release](https://img.shields.io/github/v/release/Xia-Ataraxia/obsidian-metadata-auto-classifier?logo=github)](https://github.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> The more context you give, the more accurate the classification.

![Usage Example](./assets/usecase.gif)

## Features

- **Automatic tag generation** -- AI analyzes note content and generates contextually relevant tags
- **Custom frontmatter fields** -- define any frontmatter fields and let AI populate them
- **Classification rules** -- set custom rules, tag categories, and field-specific guidelines
- **Per-field context prompts** -- provide additional context per metadata field to guide classification
- **Test and preview** -- built-in testing tools with preview mode before applying changes
- **Multi-provider support** -- built-in presets for OpenAI, Anthropic, Gemini, OpenRouter, Ollama, DeepSeek, LM Studio, and Codex (OAuth), plus custom providers
- **Custom model configuration** -- add and configure custom AI providers and models

## Installation

### Community Plugin (Recommended)

1. Open Obsidian and navigate to **Settings > Community Plugins**
2. Disable Safe Mode if currently enabled
3. Click **Browse** and search for "Metadata Auto Classifier"
4. Click **Install**, then **Enable** to activate the plugin

### Beta via BRAT

Using [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from the Obsidian Community Plugins browser
2. In BRAT settings, click **Add Beta plugin**
3. Enter the repository URL: `https://github.com/Xia-Ataraxia/obsidian-metadata-auto-classifier`
4. Click **Add Plugin** to install

![BRAT Installation](./assets/brat-install.gif)

## Usage

1. Open any note you want to classify
2. Open the Command Palette (Cmd/Ctrl + P) and run one of the commands below
3. Review and refine AI-generated suggestions as needed

### Commands

Each configured frontmatter field (including tags) gets its own command, plus one command for all fields:

| Command | Description |
|---------|-------------|
| Fetch frontmatter: `<field>` | Update a specific frontmatter field (e.g. tags) for the active note |
| Fetch frontmatter: Fetch all frontmatter using current provider | Populate all configured frontmatter fields |

### Settings

| Setting | Description |
|---------|-------------|
| AI Provider | Select a preset provider or a custom provider |
| Model | Choose or configure the model used for classification |
| Custom frontmatter fields | Define which frontmatter fields AI should generate |
| Classification rules | Set rules and categories for how tags/fields are generated |
| Field-specific prompts | Provide per-field context to guide AI output |

More background: [docs/Why I made this plugin.md](docs/Why%20I%20made%20this%20plugin.md), [docs/Architecture.md](docs/Architecture.md), [docs/Classification-Workflow.md](docs/Classification-Workflow.md).

## Development

```bash
pnpm install
pnpm dev              # vault selection + esbuild watch + hot reload
pnpm build            # tsc type-check + production build
pnpm test             # Vitest unit tests
pnpm test:watch       # Vitest watch mode
pnpm test:coverage    # Vitest with coverage report
pnpm lint             # ESLint
pnpm run ci           # build + lint + test
pnpm release:patch    # also release:minor / release:major
```

### Tech Stack

| Category | Technology |
|----------|------------|
| Platform | Obsidian Plugin API |
| Language | TypeScript 5 |
| Bundler | esbuild |
| Testing | Vitest (with coverage) |
| Linting | ESLint 9 (flat config) |

### Project Structure

```
obsidian-metadata-auto-classifier/
├── src/
│   ├── main.ts           # Plugin entry point
│   ├── domain/           # Presets, auth, core logic
│   ├── ui/               # Commands, providers, settings UI
│   └── utils/            # Pure utilities
├── __tests__/            # Vitest tests
├── __mocks__/            # Obsidian API mock
├── scripts/              # dev.mjs, version.mjs, release.mjs
├── boiler.config.mjs     # Per-repo config
└── manifest.json         # Obsidian plugin manifest
```

### Inspiration

- UI design inspired by [Obsidian Web Clipper](https://obsidian.md/clipper)
- Codex API integration inspired by [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer)

### Support

For questions, issues, or feature requests, please visit the [GitHub repository](https://github.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/issues).

## License

This project is licensed under the [MIT License](LICENSE).
