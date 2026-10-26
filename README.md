# Metadata Auto Classifier

Automatically classifies and applies metadata to your notes.

![The Auto Classifier settings: the classification rule, the provider editor with an empty API key field, the model list and the tags frontmatter rule. No API key is entered, so no classification result is shown.](https://raw.githubusercontent.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/main/docs/assets/demo.webp)

## Features

- Uses Jev to select existing values for tags and other frontmatter fields.
- Generates new values only for the exact `tags` field when **Generate new tags** is explicitly enabled; this is off by default.
- Preserves field instructions, references, minimum/maximum counts, overwrite/append and WikiLink options. Writes preserve unrelated frontmatter and note text.
- Optional tag-generation providers include OpenAI, Anthropic, Gemini, OpenRouter, Ollama, DeepSeek, LM Studio, Codex (OAuth), and an explicitly configured OpenAI-compatible custom endpoint.

## Usage

1. Open **Settings**, **Metadata Auto Classifier**, and configure Jev for existing-value selection. Jev uses its own credential, separate from an OpenAI or other generation-provider key.
2. Define the fields, existing reference values, instructions and count limits. For optional new tags, edit the exact `tags` field, enable **Generate new tags**, and configure a generation provider/model. Local Ollama and LM Studio can be keyless.
3. Open a note and run **Fetch frontmatter: Fetch all frontmatter using current provider** from the command palette, or **Fetch frontmatter: tags** (or another field) for one field.
4. Review the result in the note's properties.

Ordinary fields never generate new values. Ambiguous selection or a failed required generation request leaves the field unchanged. The maximum count limits values selected/generated in that operation, not the total values already present when appending. Empty candidates skip Jev; no remaining generation slots skip the optional provider.

## Installation

**Community plugins**: open Settings, Community plugins, Browse, search for "Metadata Auto Classifier", then Install and Enable.

**Manual**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/releases/latest) into `<vault>/<configDir>/plugins/metadata-auto-classifier/`, then enable the plugin. `<configDir>` is your vault's configuration folder (`.obsidian` by default).

## Disclosures

- **Network use**: selection sends the note body, instructions and candidate values to Jev. Explicitly enabled tag generation sends the note body, instructions and excluded/existing values to the configured generation provider. Reference values may come from metadata on other notes; those other note bodies are not sent by classification.
- **Account or payment**: Jev and generation-provider credentials are separate. Providers bill usage according to the selected account/model; model presets do not guarantee availability or pricing. API keys and OAuth tokens are stored in the plugin's settings file; do not commit or share that file.
- **Codex sign-in**: hosted device authorization contacts `auth.openai.com`; Codex inference contacts `chatgpt.com`. The verification page opens only after an explicit click. There is no local callback server or automatic clipboard copy. Refresh remains account-bound and must be saved before retrying.
- **Transport**: requests use Obsidian's native `requestUrl`, not Node HTTP streaming. Cancellation prevents stale processing/writes but cannot physically cancel a request already dispatched by that API.
- **Folder contents**: the note picker for reference values lists one folder at a time as you browse. When a field has no reference values, the plugin reads the tags or property values used by notes in the classified note's own folder. It never scans the whole vault, and nothing beyond the note being classified is sent to a provider.
- **Telemetry**: none.

Offline tests do not certify live-account entitlement, mobile execution or semantic classification quality.

## Development

See the [dev contract](https://github.com/GoBeromsu/obsidian-boiler-template#dev-contract): `bun run dev`, `bun run build`, `bun run ci`.

Install with `bun install --frozen-lockfile`. Builds go to `dist/`; workspace tooling owns development-vault deployment. Shared CI/release workflows remain referenced from the upstream template.

## License

[MIT](LICENSE)
