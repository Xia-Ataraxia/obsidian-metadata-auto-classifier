import type { ModelCatalog, ModelKind, ModelMeta } from '../types/insights';
import bundledCatalog from './model-catalog.json';
import providerPresetsData from './presets.json';

export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

type Raw = Record<string, unknown>;

const MODELS_DEV_PROVIDERS: Record<string, string> = {
	OpenAI: 'openai',
	Anthropic: 'anthropic',
	Gemini: 'google',
	DeepSeek: 'deepseek',
	Codex: 'openai',
};
const LOCAL_PROVIDERS = new Set(['Ollama', 'LM Studio']);
const OPENROUTER_PROVIDER = 'OpenRouter';
const UNPRICED_PROVIDERS = new Set(['TypeSafe']);
const SUBSCRIPTION_PROVIDERS = new Set(['Codex']);

function isRaw(value: unknown): value is Raw {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function emptyMeta(kind: ModelKind): ModelMeta {
	return {
		kind,
		inputPerMTok: null,
		outputPerMTok: null,
		cacheReadPerMTok: null,
		cacheWritePerMTok: null,
		contextTokens: null,
		maxOutputTokens: null,
		knowledge: null,
		intelligenceIndex: null,
	};
}

function fromModelsDev(model: Raw, kind: ModelKind): ModelMeta {
	const cost = isRaw(model.cost) ? model.cost : {};
	const limit = isRaw(model.limit) ? model.limit : {};
	const priced = kind === 'priced';
	return {
		...emptyMeta(kind),
		inputPerMTok: priced ? num(cost.input) : null,
		outputPerMTok: priced ? num(cost.output) : null,
		cacheReadPerMTok: priced ? num(cost.cache_read) : null,
		cacheWritePerMTok: priced ? num(cost.cache_write) : null,
		contextTokens: num(limit.context),
		maxOutputTokens: num(limit.output),
		knowledge: text(model.knowledge),
	};
}

function perMTok(value: unknown): number | null {
	const parsed = typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1e9) / 1e3 : null;
}

function fromOpenRouter(model: Raw): ModelMeta {
	const pricing = isRaw(model.pricing) ? model.pricing : {};
	const top = isRaw(model.top_provider) ? model.top_provider : {};
	const input = perMTok(pricing.prompt);
	const output = perMTok(pricing.completion);
	return {
		...emptyMeta(input === null || output === null ? 'unpriced' : 'priced'),
		inputPerMTok: input,
		outputPerMTok: output,
		cacheReadPerMTok: perMTok(pricing.input_cache_read),
		cacheWritePerMTok: perMTok(pricing.input_cache_write),
		contextTokens: num(model.context_length),
		maxOutputTokens: num(top.max_completion_tokens),
		intelligenceIndex: indexOf(model),
	};
}

function indexOf(model: Raw | undefined): number | null {
	const benchmarks = model && isRaw(model.benchmarks) ? model.benchmarks : undefined;
	const analysis =
		benchmarks && isRaw(benchmarks.artificial_analysis) ? benchmarks.artificial_analysis : undefined;
	return analysis ? num(analysis.intelligence_index) : null;
}

/** Anthropic ids use `claude-haiku-5-5`; OpenRouter slugs use `claude-haiku-5.5`. */
function openRouterSlugs(modelsDevProvider: string, id: string): string[] {
	return [
		`${modelsDevProvider}/${id}`,
		`${modelsDevProvider}/${id.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`,
	];
}

function isTextModel(model: Raw): boolean {
	const modalities = isRaw(model.modalities) ? model.modalities : {};
	const outputs: unknown[] = Array.isArray(modalities.output) ? modalities.output : [];
	return isRaw(model.cost) && outputs.includes('text') && model.status !== 'deprecated';
}

function popularIds(preset: { popularModels: Array<{ id: string }> }): string[] {
	return preset.popularModels.map((model) => model.id);
}

export interface CatalogInput {
	modelsDev: unknown;
	/** Optional: only the dev-time generator contacts OpenRouter; refreshes keep `previous` values. */
	openRouter?: unknown;
	previous?: ModelCatalog;
	generatedAt: string;
}

export function normalizeCatalog(input: CatalogInput): ModelCatalog {
	const dev = isRaw(input.modelsDev) ? input.modelsDev : {};
	const routerList: unknown[] =
		isRaw(input.openRouter) && Array.isArray(input.openRouter.data) ? input.openRouter.data : [];
	const router = new Map<string, Raw>();
	for (const item of routerList) if (isRaw(item) && typeof item.id === 'string') router.set(item.id, item);

	const models: ModelCatalog['models'] = {};
	for (const preset of Object.values(providerPresetsData)) {
		const name = preset.name;
		const previous = input.previous?.models[name] ?? {};
		const entries: Record<string, ModelMeta> = {};
		const devKey = MODELS_DEV_PROVIDERS[name];
		if (devKey) {
			const provider = dev[devKey];
			const devModels = isRaw(provider) && isRaw(provider.models) ? provider.models : {};
			const kind: ModelKind = SUBSCRIPTION_PROVIDERS.has(name) ? 'subscription' : 'priced';
			const popular = popularIds(preset);
			for (const [id, model] of Object.entries(devModels)) {
				if (!isRaw(model) || !isTextModel(model)) continue;
				if (SUBSCRIPTION_PROVIDERS.has(name) && !popular.includes(id)) continue;
				const routed = openRouterSlugs(devKey, id)
					.map((slug) => router.get(slug))
					.find(Boolean);
				entries[id] = {
					...fromModelsDev(model, kind),
					intelligenceIndex: indexOf(routed) ?? previous[id]?.intelligenceIndex ?? null,
				};
			}
		} else if (name === OPENROUTER_PROVIDER) {
			for (const id of popularIds(preset)) {
				const routed = router.get(id);
				const prior = previous[id];
				if (routed) entries[id] = fromOpenRouter(routed);
				else if (prior) entries[id] = prior;
			}
		} else if (LOCAL_PROVIDERS.has(name)) {
			for (const id of popularIds(preset)) entries[id] = emptyMeta('local');
		} else if (UNPRICED_PROVIDERS.has(name)) {
			for (const id of popularIds(preset)) entries[id] = emptyMeta('unpriced');
		}
		if (Object.keys(entries).length > 0) models[name] = entries;
	}
	const sources = ['models.dev'];
	if (routerList.length > 0 || input.previous?.sources.includes('openrouter.ai')) {
		sources.push('openrouter.ai');
	}
	return { schemaVersion: 1, generatedAt: input.generatedAt, sources, models };
}

export function pricedModelCount(catalog: ModelCatalog): number {
	return Object.values(catalog.models)
		.flatMap((entries) => Object.values(entries))
		.filter((meta) => meta.kind === 'priced' && meta.inputPerMTok !== null).length;
}

/** Cached catalogs come from disk, so anything but the current shape falls back to the bundled copy. */
export function parseCatalog(value: unknown): ModelCatalog | undefined {
	if (!isRaw(value) || value.schemaVersion !== 1 || !isRaw(value.models)) return undefined;
	if (typeof value.generatedAt !== 'string' || !Array.isArray(value.sources)) return undefined;
	return value as unknown as ModelCatalog;
}

export function getBundledCatalog(): ModelCatalog {
	return bundledCatalog as ModelCatalog;
}

export function resolveModelMeta(
	catalog: ModelCatalog,
	provider: string,
	modelId: string
): ModelMeta | undefined {
	const entries = catalog.models[provider];
	return entries && Object.prototype.hasOwnProperty.call(entries, modelId) ? entries[modelId] : undefined;
}
