# Why I Built Metadata Auto Classifier

## The Problem: Metadata is Powerful, But Manual Entry is Painful

If you've used Obsidian for a while, you know the power of metadata. Tags, categories, and custom frontmatter fields transform a pile of notes into a searchable, interconnected knowledge base.

But there's a catch: **manual metadata entry doesn't scale.**

### The Pain Points

| Problem | Impact |
|---------|--------|
| **Time-consuming** | Adding tags to 100 notes = hours of repetitive work |
| **Inconsistent** | Monday you use `#javascript`, Friday you use `#js` |
| **Cognitive overhead** | Every note requires a decision: "What tags fit here?" |
| **Backlog paralysis** | Old notes remain untagged because "I'll do it later" |

I experienced this firsthand. My vault grew to hundreds of notes, but my tagging became increasingly inconsistent. Some notes had perfect metadata; others had none. The knowledge graph that should have emerged never materialized.

## Why Existing Approaches Fall Short

### Manual Tagging
- Pros: Full control, human judgment
- Cons: Doesn't scale, prone to inconsistency, requires constant attention

### Template-based Systems
- Pros: Consistent structure
- Cons: One-size-fits-all, doesn't adapt to content, still requires manual input

### Rule-based Auto-tagging
- Pros: Automated
- Cons: Brittle rules, can't understand context, misses nuance

**What was missing**: A system that could *understand* the content and suggest appropriate metadata—the way a human would, but automatically.

## The Solution: AI-Powered Metadata Classification

**Metadata Auto Classifier** uses Large Language Models to analyze your note content and suggest relevant metadata values. Instead of you reading each note and deciding "this is about JavaScript and React," the plugin does it for you.

### How It Works

1. **You define** what metadata fields matter to you (tags, categories, topics, etc.)
2. **You provide** reference values (your existing tags, categories you use)
3. **The plugin reads** your note content
4. **AI suggests** the most relevant values from your references
5. **Frontmatter is updated** automatically

### Core Value Proposition

> **Consistent metadata at scale, without the manual overhead.**

You maintain control over *what* categories exist. The AI handles *which* categories apply to each note.

## Who Is This For?

### Ideal Users

- **Knowledge workers** with 100+ notes who struggle to maintain consistent tagging
- **Researchers** organizing literature notes and wanting consistent categorization
- **Writers** managing content across multiple topics and formats
- **Developers** maintaining technical documentation and code notes

### Not Ideal For

- Users with fewer than 50 notes (manual tagging is still efficient)
- Those who prefer fully manual control over every metadata decision
- Vaults where note content is minimal (titles only, bullet points)

## Real-World Use Cases

### Use Case 1: Literature Review

You've imported 50 research papers. Each needs to be tagged with themes, methodologies, and relevance to your work.

**Before**: Read each paper, manually decide tags, inevitably forget some.
**After**: Run the classifier, review suggestions, bulk-apply in minutes.

### Use Case 2: Developer Knowledge Base

Your vault contains debugging notes, architecture decisions, code snippets across multiple languages.

**Before**: Inconsistent tags (`#debugging` vs `#debug` vs `#troubleshooting`)
**After**: Consistent taxonomy automatically applied based on content.

### Use Case 3: Personal Knowledge Management

Journal entries, book notes, project ideas—all mixed together.

**Before**: "I'll tag it later" → never happens
**After**: Automatic categorization as you write

## Current Features

- **Multi-provider support**: OpenAI, Anthropic, Gemini, Ollama (local), and more
- **Custom frontmatter fields**: Define any metadata field, not just tags
- **Reference-based classification**: AI picks from *your* existing values
- **Reliability scoring**: See how confident the AI is in its suggestions
- **Batch processing**: Classify multiple notes at once

## Roadmap: What's Coming

| Feature | User Benefit |
|---------|--------------|
| **Partial content analysis** | Classify based on selected text, not entire note |
| **Smart chunking for long notes** | Handle large documents without token limits |
| **Custom classification rules** | "For notes mentioning 'API', always suggest #backend" |
| **Bulk retroactive tagging** | Tag your entire vault in one go |
| **Confidence thresholds** | Auto-apply high-confidence, review low-confidence |

## Technical Philosophy

This plugin is built with a few principles:

1. **User control**: AI suggests, you decide. No black-box magic.
2. **Provider flexibility**: Not locked to OpenAI. Use local models if you prefer.
3. **Transparency**: See reliability scores, understand why suggestions were made.
4. **Non-destructive**: Original content is never modified, only frontmatter.

## Get Involved

This is an open-source project. Contributions are welcome:

- **Bug reports**: [GitHub Issues](https://github.com/Xia-Ataraxia/obsidian-metadata-auto-classifier/issues)
- **Feature requests**: What would make this more useful for you?
- **Code contributions**: PRs welcome, see contribution guidelines

---

*Built by someone who got tired of manually tagging notes and thought, "There has to be a better way."*
