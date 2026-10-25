# Metadata Auto Classifier

Automatically classifies and applies metadata to your notes.

![The Auto Classifier settings: the classification rule, the provider editor with an empty API key field, the model list and the tags frontmatter rule. No API key is entered, so no classification result is shown.](https://raw.githubusercontent.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/main/docs/assets/demo.webp)

## Features

- Generates tags and any custom frontmatter fields from the note's content.
- Classification rules, tag categories, and per-field context prompts guide the result. The more context you give, the more accurate it is.
- Presets for OpenAI, Anthropic, Gemini, OpenRouter, Ollama, DeepSeek, LM Studio and Codex (OAuth), plus custom providers and models.

## Usage

1. Open **Settings**, **Metadata Auto Classifier**, pick a provider and model, and enter its API key (not needed for Ollama or LM Studio).
2. Define the frontmatter fields to fill, and optionally rules and per-field prompts.
3. Open a note and run **Fetch frontmatter: Fetch all frontmatter using current provider** from the command palette, or **Fetch frontmatter: tags** (or another field) for one field.
4. Review the result in the note's properties.

## Installation

**Community plugins**: open Settings, Community plugins, Browse, search for "Metadata Auto Classifier", then Install and Enable.

**Manual**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/releases/latest) into `<vault>/<configDir>/plugins/metadata-auto-classifier/`, then enable the plugin. `<configDir>` is your vault's configuration folder (`.obsidian` by default).

## Disclosures

- **Network use**: the active note's content and your classification rules are sent to the AI provider you select (OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, a custom endpoint, or `localhost` for Ollama and LM Studio) to generate metadata.
- **Account or payment**: a provider API key, or a ChatGPT account for Codex sign-in. Usage is billed by the provider. Keys are stored in the plugin's settings file.
- **Codex sign-in**: the OAuth flow contacts `auth.openai.com` and `chatgpt.com`, and briefly listens on `localhost:1455` for the callback.
- **Telemetry**: none.

## Development

See the [dev contract](https://github.com/GoBeromsu/obsidian-boiler-template#dev-contract): `bun run dev`, `bun run build`, `bun run ci`.

## License

[MIT](LICENSE)
