import {
	getBundledCatalog,
	normalizeCatalog,
	parseCatalog,
	resolveModelMeta,
} from '../../src/domain/model-catalog';
import presets from '../../src/domain/presets.json';

const modelsDev = {
	openai: {
		models: {
			'gpt-6-luna': {
				cost: { input: 0.1, output: 0.5, cache_read: 0.01 },
				limit: { context: 1000, output: 100 },
				modalities: { output: ['text'] },
				knowledge: '2026-05',
			},
			'gpt-tts': { cost: { input: 1, output: 1 }, modalities: { output: ['audio'] } },
			'gpt-old': { cost: { input: 1, output: 1 }, modalities: { output: ['text'] }, status: 'deprecated' },
		},
	},
	anthropic: {
		models: {
			'claude-haiku-5-5': { cost: { input: 1, output: 2 }, modalities: { output: ['text'] } },
		},
	},
};

describe('bundled catalog', () => {
	test('every preset model has an entry, so settings rows never lose their price by accident', () => {
		const missing = Object.values(presets).flatMap((preset) =>
			preset.popularModels
				.filter((model) => !resolveModelMeta(getBundledCatalog(), preset.name, model.id))
				.map((model) => `${preset.name}/${model.id}`)
		);
		expect(missing).toEqual([]);
	});

	test('local and plan-billed providers never carry a per-token price', () => {
		const catalog = getBundledCatalog();
		for (const provider of ['Ollama', 'LM Studio', 'Codex']) {
			for (const meta of Object.values(catalog.models[provider] ?? {})) {
				expect(meta.inputPerMTok).toBeNull();
			}
		}
	});
});

describe('normalizeCatalog', () => {
	test('keeps text models only and joins the index across id spellings', () => {
		const catalog = normalizeCatalog({
			modelsDev,
			openRouter: {
				data: [{ id: 'anthropic/claude-haiku-5.5', benchmarks: { artificial_analysis: { intelligence_index: 36 } } }],
			},
			generatedAt: '2026-11-01',
		});
		expect(Object.keys(catalog.models.OpenAI ?? {})).toEqual(['gpt-6-luna']);
		expect(catalog.models.OpenAI?.['gpt-6-luna']).toMatchObject({ inputPerMTok: 0.1, contextTokens: 1000 });
		expect(catalog.models.Anthropic?.['claude-haiku-5-5']?.intelligenceIndex).toBe(36);
	});

	test('a price refresh keeps the index and OpenRouter entries it cannot fetch', () => {
		const previous = getBundledCatalog();
		const next = normalizeCatalog({ modelsDev, previous, generatedAt: '2026-12-01' });
		expect(next.models.OpenAI?.['gpt-6-luna']?.intelligenceIndex).toBe(
			previous.models.OpenAI?.['gpt-6-luna']?.intelligenceIndex
		);
		expect(next.models.OpenRouter).toEqual(previous.models.OpenRouter);
		expect(next.sources).toContain('openrouter.ai');
	});
});

describe('parseCatalog', () => {
	test('rejects other shapes', () => {
		expect(parseCatalog({ schemaVersion: 2, models: {} })).toBeUndefined();
		expect(parseCatalog(null)).toBeUndefined();
		expect(parseCatalog(getBundledCatalog())).toBeDefined();
	});
});
