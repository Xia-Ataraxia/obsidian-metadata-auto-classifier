import type { Model, ProviderConfig } from '../types';
import type { ModelCatalog, ModelMeta, TokenUsage, UsageBucket, UsageLedger } from '../types/insights';
import { decisionTransport } from './decision-formats';
import { resolveModelMeta } from './model-catalog';
import providerPresetsData from './presets.json';
import { bucketKey, median, monthKey, usageCost } from './usage-ledger';

/** Shown until the ledger has a real classification; always labeled as an example in the UI. */
export const EXAMPLE_TOKENS_PER_NOTE: TokenUsage = {
	inputTokens: 2500,
	outputTokens: 120,
	cachedInputTokens: 0,
	cacheWriteTokens: 0,
};

// The chart compares API options; subscription and local models join only once configured.
const COMPARED_PRESETS = new Set(['OpenAI', 'Anthropic', 'Gemini', 'DeepSeek']);

export interface InsightModel {
	provider: string;
	id: string;
	name: string;
	meta: ModelMeta | undefined;
	decision: boolean;
	selected: boolean;
	latencyMs: number | null;
}

export interface ModelSelectionRef {
	provider: string;
	model: string;
}

function allBuckets(ledger: UsageLedger): Array<[string, UsageBucket]> {
	return Object.values(ledger.months).flatMap((entries) => Object.entries(entries));
}

function latencyOf(ledger: UsageLedger, provider: string, model: string): number | null {
	const key = bucketKey(provider, model);
	return median(
		allBuckets(ledger)
			.filter(([bucket]) => bucket === key)
			.flatMap(([, bucket]) => bucket.latenciesMs)
	);
}

export function listInsightModels(
	providers: ReadonlyArray<ProviderConfig>,
	catalog: ModelCatalog,
	ledger: UsageLedger,
	selection: ModelSelectionRef | undefined
): InsightModel[] {
	const rows = new Map<string, InsightModel>();
	const add = (provider: string, model: Pick<Model, 'id' | 'name' | 'decision'>) => {
		const key = bucketKey(provider, model.id);
		if (rows.has(key)) return;
		rows.set(key, {
			provider,
			id: model.id,
			name: (model.name || model.id).replace(/ \(Decisions\)$/, ''),
			meta: resolveModelMeta(catalog, provider, model.id),
			decision: !!decisionTransport(provider, model),
			selected: selection?.provider === provider && selection.model === model.id,
			latencyMs: latencyOf(ledger, provider, model.id),
		});
	};
	for (const provider of providers) for (const model of provider.models) add(provider.name, model);
	for (const preset of Object.values(providerPresetsData)) {
		if (!COMPARED_PRESETS.has(preset.name)) continue;
		for (const model of preset.popularModels as Array<Model>) add(preset.name, model);
	}
	return [...rows.values()];
}

export interface TokensPerNote {
	tokens: TokenUsage;
	/** real: this model's own runs. blended: all models' runs. example: no runs yet. */
	source: 'real' | 'blended' | 'example';
}

function averagePerNote(buckets: UsageBucket[]): TokenUsage | undefined {
	const notes = buckets.reduce((sum, bucket) => sum + bucket.notes, 0);
	if (notes === 0) return undefined;
	const total = (pick: (bucket: UsageBucket) => number) =>
		buckets.reduce((sum, bucket) => sum + pick(bucket), 0) / notes;
	const usage: TokenUsage = {
		inputTokens: total((bucket) => bucket.inputTokens),
		outputTokens: total((bucket) => bucket.outputTokens),
		cachedInputTokens: total((bucket) => bucket.cachedInputTokens),
		cacheWriteTokens: total((bucket) => bucket.cacheWriteTokens),
	};
	const sum = usage.inputTokens + usage.outputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
	return sum > 0 ? usage : undefined;
}

export function tokensPerNote(ledger: UsageLedger, selection: ModelSelectionRef | undefined): TokensPerNote {
	const buckets = allBuckets(ledger);
	if (selection) {
		const key = bucketKey(selection.provider, selection.model);
		const own = averagePerNote(buckets.filter(([bucket]) => bucket === key).map(([, bucket]) => bucket));
		if (own) return { tokens: own, source: 'real' };
	}
	const blended = averagePerNote(buckets.map(([, bucket]) => bucket));
	return blended ? { tokens: blended, source: 'blended' } : { tokens: EXAMPLE_TOKENS_PER_NOTE, source: 'example' };
}

export function costForNotes(meta: ModelMeta | undefined, tokens: TokenUsage, notes: number): number | null {
	const perNote = usageCost(tokens, meta);
	return perNote === null ? null : perNote * notes;
}

export interface CacheStats {
	hasData: boolean;
	hitRate: number;
	savedUsd: number;
	savedShare: number;
}

export function cacheStats(ledger: UsageLedger, catalog: ModelCatalog): CacheStats {
	let fresh = 0;
	let cached = 0;
	let written = 0;
	let saved = 0;
	let spent = 0;
	for (const [key, bucket] of allBuckets(ledger)) {
		fresh += bucket.inputTokens;
		cached += bucket.cachedInputTokens;
		written += bucket.cacheWriteTokens;
		const [provider = '', model = ''] = splitKey(key);
		const meta = resolveModelMeta(catalog, provider, model);
		spent += usageCost(bucket, meta) ?? 0;
		if (meta?.kind !== 'priced' || meta.inputPerMTok === null) continue;
		const input = meta.inputPerMTok;
		saved +=
			(bucket.cachedInputTokens * (input - (meta.cacheReadPerMTok ?? input)) +
				bucket.cacheWriteTokens * (input - (meta.cacheWritePerMTok ?? input))) /
			1e6;
	}
	const total = fresh + cached + written;
	const savedUsd = Math.max(0, saved);
	return {
		hasData: total > 0,
		hitRate: total > 0 ? cached / total : 0,
		savedUsd,
		savedShare: spent + savedUsd > 0 ? savedUsd / (spent + savedUsd) : 0,
	};
}

function splitKey(key: string): [string, string] {
	const index = key.indexOf('::');
	return [key.slice(0, index), key.slice(index + 2)];
}

export interface MonthSpend {
	key: string;
	label: string;
	notes: number;
	inputUsd: number;
	cachedUsd: number;
	outputUsd: number;
	totalUsd: number;
	/** Current month only: straight-line projection from days elapsed. */
	projectedUsd: number | null;
}

// A straight line from the first few days of a month says more about one busy day than the month.
const MIN_DAYS_TO_PROJECT = 7;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthlySpend(
	ledger: UsageLedger,
	catalog: ModelCatalog,
	now: Date,
	count = 6
): MonthSpend[] {
	const series: MonthSpend[] = [];
	for (let back = count - 1; back >= 0; back--) {
		const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
		const key = monthKey(date);
		const month: MonthSpend = {
			key,
			label: MONTH_LABELS[date.getMonth()] as string,
			notes: 0,
			inputUsd: 0,
			cachedUsd: 0,
			outputUsd: 0,
			totalUsd: 0,
			projectedUsd: null,
		};
		for (const [bucketId, bucket] of Object.entries(ledger.months[key] ?? {})) {
			month.notes += bucket.notes;
			const [provider, model] = splitKey(bucketId);
			const meta = resolveModelMeta(catalog, provider, model);
			if (meta?.kind !== 'priced' || meta.inputPerMTok === null || meta.outputPerMTok === null) continue;
			const input = meta.inputPerMTok;
			month.inputUsd +=
				(bucket.inputTokens * input + bucket.cacheWriteTokens * (meta.cacheWritePerMTok ?? input)) / 1e6;
			month.cachedUsd += (bucket.cachedInputTokens * (meta.cacheReadPerMTok ?? input)) / 1e6;
			month.outputUsd += (bucket.outputTokens * meta.outputPerMTok) / 1e6;
		}
		month.totalUsd = month.inputUsd + month.cachedUsd + month.outputUsd;
		if (back === 0 && month.totalUsd > 0 && now.getDate() >= MIN_DAYS_TO_PROJECT) {
			const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
			month.projectedUsd = (month.totalUsd * days) / now.getDate();
		}
		series.push(month);
	}
	return series;
}

export type AxisId = 'cost' | 'intelligence' | 'input' | 'context' | 'latency';

export interface AxisDefinition {
	id: AxisId;
	label: string;
	log: boolean;
	value: (model: InsightModel, tokens: TokenUsage) => number | null;
	format: (value: number) => string;
}

export const AXES: AxisDefinition[] = [
	{
		id: 'cost',
		label: 'Cost per 1,000 notes',
		log: true,
		value: (model, tokens) => costForNotes(model.meta, tokens, 1000),
		format: formatUsd,
	},
	{
		id: 'intelligence',
		label: 'Intelligence index',
		log: false,
		value: (model) => model.meta?.intelligenceIndex ?? null,
		format: (value) => String(Math.round(value)),
	},
	{
		id: 'input',
		label: 'Input price per MTok',
		log: true,
		value: (model) => model.meta?.inputPerMTok ?? null,
		format: formatUsd,
	},
	{
		id: 'context',
		label: 'Context window',
		log: true,
		value: (model) => model.meta?.contextTokens ?? null,
		format: formatTokens,
	},
	{
		id: 'latency',
		label: 'Measured latency (median)',
		log: false,
		value: (model) => model.latencyMs,
		format: formatLatency,
	},
];

export function formatUsd(value: number): string {
	if (value === 0) return '$0';
	if (value < 0.01) return `$${value.toFixed(4).replace(/0+$/, '')}`;
	if (value < 1) return `$${value.toFixed(3).replace(/0$/, '')}`;
	return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
	if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
	if (value >= 1e4) return `${Math.round(value / 1e3)}K`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
	return String(Math.round(value));
}

export function formatLatency(value: number): string {
	return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

export function modelChips(meta: ModelMeta | undefined): string[] {
	if (!meta) return [];
	const chips: string[] = [];
	if (meta.kind === 'local') chips.push('Local');
	else if (meta.kind === 'subscription') chips.push('Included in plan');
	else if (meta.inputPerMTok !== null && meta.outputPerMTok !== null) {
		chips.push(`${formatUsd(meta.inputPerMTok)} / ${formatUsd(meta.outputPerMTok)} per MTok`);
	}
	if (meta.contextTokens !== null) chips.push(`${formatTokens(meta.contextTokens)} context`);
	return chips;
}
