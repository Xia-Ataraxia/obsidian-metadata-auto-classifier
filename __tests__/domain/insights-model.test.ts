import { efficiencyFrontier, logScale, placeLabels } from '../../src/domain/chart-scales';
import {
	AXES,
	cacheStats,
	costForNotes,
	EXAMPLE_TOKENS_PER_NOTE,
	formatUsd,
	listInsightModels,
	modelChips,
	monthlySpend,
	tokensPerNote,
} from '../../src/domain/insights-model';
import { getBundledCatalog } from '../../src/domain/model-catalog';
import { addLatency, addNote, addUsage, emptyLedger, parseLedger, usageCost } from '../../src/domain/usage-ledger';
import type { ModelCatalog, ModelMeta } from '../../src/types/insights';

const meta = (over: Partial<ModelMeta> = {}): ModelMeta => ({
	kind: 'priced',
	inputPerMTok: 1,
	outputPerMTok: 2,
	cacheReadPerMTok: 0.1,
	cacheWritePerMTok: 1.25,
	contextTokens: 1000,
	maxOutputTokens: 100,
	knowledge: null,
	intelligenceIndex: 50,
	...over,
});
const catalog: ModelCatalog = {
	schemaVersion: 1,
	generatedAt: '2026-11-01',
	sources: [],
	models: { OpenAI: { m: meta() }, Ollama: { local: meta({ kind: 'local', inputPerMTok: null, outputPerMTok: null }) } },
};
const usage = (inputTokens: number, cachedInputTokens = 0, outputTokens = 0, cacheWriteTokens = 0) => ({
	inputTokens,
	cachedInputTokens,
	outputTokens,
	cacheWriteTokens,
});

describe('usageCost', () => {
	test('prices each token class separately', () => {
		expect(usageCost(usage(1e6, 1e6, 1e6, 1e6), meta())).toBeCloseTo(1 + 0.1 + 2 + 1.25);
	});
	test('local is free and unknown or unpriced has no cost', () => {
		expect(usageCost(usage(1e6), meta({ kind: 'local' }))).toBe(0);
		expect(usageCost(usage(1e6), undefined)).toBeNull();
		expect(usageCost(usage(1e6), meta({ kind: 'subscription' }))).toBeNull();
	});
});

describe('tokensPerNote', () => {
	test('falls back from the model to all runs to a labeled example', () => {
		const ledger = emptyLedger();
		const selection = { provider: 'OpenAI', model: 'm' };
		expect(tokensPerNote(ledger, selection)).toEqual({ tokens: EXAMPLE_TOKENS_PER_NOTE, source: 'example' });
		addUsage(ledger, '2026-10', 'Other', 'x', usage(1000), 10);
		addNote(ledger, '2026-10', 'Other', 'x');
		expect(tokensPerNote(ledger, selection).source).toBe('blended');
		addUsage(ledger, '2026-11', 'OpenAI', 'm', usage(300), 10);
		addUsage(ledger, '2026-11', 'OpenAI', 'm', usage(100), 10);
		addNote(ledger, '2026-11', 'OpenAI', 'm');
		expect(tokensPerNote(ledger, selection)).toMatchObject({ source: 'real', tokens: { inputTokens: 400 } });
	});
	test('connection tests add latency without skewing token averages', () => {
		const ledger = emptyLedger();
		addLatency(ledger, '2026-11', 'OpenAI', 'm', 200);
		expect(tokensPerNote(ledger, { provider: 'OpenAI', model: 'm' }).source).toBe('example');
		const row = listInsightModels(
			[{ name: 'OpenAI', baseUrl: '', models: [{ id: 'm', name: 'M' }] }],
			catalog,
			ledger,
			{ provider: 'OpenAI', model: 'm' }
		)[0];
		expect(row).toMatchObject({ latencyMs: 200, selected: true, decision: false });
	});
});

describe('cacheStats', () => {
	test('no data is distinct from a zero hit rate', () => {
		expect(cacheStats(emptyLedger(), catalog).hasData).toBe(false);
	});
	test('hit rate and savings come from recorded tokens', () => {
		const ledger = emptyLedger();
		addUsage(ledger, '2026-11', 'OpenAI', 'm', usage(1e6, 1e6), 1);
		const stats = cacheStats(ledger, catalog);
		expect(stats.hitRate).toBeCloseTo(0.5);
		expect(stats.savedUsd).toBeCloseTo(0.9);
		expect(stats.savedShare).toBeCloseTo(0.9 / (1.1 + 0.9));
	});
});

describe('monthlySpend', () => {
	test('returns six months and projects only the current one', () => {
		const ledger = emptyLedger();
		addUsage(ledger, '2026-11', 'OpenAI', 'm', usage(1e6), 1);
		addUsage(ledger, '2026-10', 'OpenAI', 'm', usage(2e6), 1);
		const series = monthlySpend(ledger, catalog, new Date(2026, 10, 15));
		expect(series.map((month) => month.key)).toEqual([
			'2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
		]);
		expect(series[4]).toMatchObject({ totalUsd: 2, projectedUsd: null });
		expect(series[5]?.projectedUsd).toBeCloseTo(2);
		expect(monthlySpend(ledger, catalog, new Date(2026, 10, 2))[5]?.projectedUsd).toBeNull();
	});
});

describe('listInsightModels', () => {
	test('includes presets, skips duplicates, marks Decision models', () => {
		const rows = listInsightModels(
			[{ name: 'OpenAI', baseUrl: '', models: [{ id: 'gpt-6-luna', name: 'Mine', decision: true }] }],
			getBundledCatalog(),
			emptyLedger(),
			undefined
		);
		const luna = rows.filter((row) => row.provider === 'OpenAI' && row.id === 'gpt-6-luna');
		expect(luna).toHaveLength(1);
		expect(luna[0]).toMatchObject({ name: 'Mine', decision: true });
		expect(rows.some((row) => row.provider === 'Codex')).toBe(false);
		expect(rows.some((row) => row.provider === 'Anthropic')).toBe(true);
	});
});

describe('display helpers', () => {
	test('costForNotes and the cost axis agree and stay null when unknown', () => {
		const cost = AXES.find((axis) => axis.id === 'cost');
		const row = { provider: 'p', id: 'i', name: 'n', meta: meta(), decision: false, selected: false, latencyMs: null };
		expect(cost?.value(row, usage(1000))).toBeCloseTo(costForNotes(meta(), usage(1000), 1000) as number);
		expect(cost?.value({ ...row, meta: undefined }, usage(1000))).toBeNull();
	});
	test('formatUsd keeps small values readable', () => {
		expect(formatUsd(0)).toBe('$0');
		expect(formatUsd(0.0025)).toBe('$0.0025');
		expect(formatUsd(0.26)).toBe('$0.26');
		expect(formatUsd(12.5)).toBe('$12.50');
	});
	test('chips describe price and context by kind', () => {
		expect(modelChips(meta({ inputPerMTok: 0.1, outputPerMTok: 0.5, contextTokens: 1050000 }))).toEqual([
			'$0.10 / $0.50 per MTok',
			'1.05M context',
		]);
		expect(modelChips(meta({ kind: 'local', contextTokens: null }))).toEqual(['Local']);
		expect(modelChips(undefined)).toEqual([]);
	});
});

describe('chart scales', () => {
	test('the frontier keeps only models smarter than everything cheaper', () => {
		const frontier = efficiencyFrontier([
			{ id: 'a', x: 1, y: 30 },
			{ id: 'b', x: 2, y: 20 },
			{ id: 'c', x: 3, y: 50 },
			{ id: 'd', x: 1, y: 40 },
		]);
		expect(frontier.map((point) => point.id)).toEqual(['d', 'c']);
	});
	test('the log scale spans whole decades', () => {
		const scale = logScale([0.2, 8], 0, 100);
		expect(scale.toPixel(0.1)).toBeCloseTo(0);
		expect(scale.toPixel(10)).toBeCloseTo(100);
	});
	test('labels avoid each other and the plot edge', () => {
		const labels = placeLabels(
			[
				{ id: 'a', text: 'Long model name', x: 195, y: 50 },
				{ id: 'b', text: 'Other name', x: 40, y: 50 },
				{ id: 'c', text: 'Third', x: 42, y: 50 },
			],
			{ left: 0, right: 200, top: 0, bottom: 100 }
		);
		expect(labels.find((label) => label.id === 'a')?.anchor).toBe('end');
		const b = labels.find((label) => label.id === 'b');
		const c = labels.find((label) => label.id === 'c');
		expect([b?.labelX, b?.labelY]).not.toEqual([c?.labelX, c?.labelY]);
	});
});

describe('parseLedger', () => {
	test('damaged files start a new ledger and damaged buckets are dropped', () => {
		expect(parseLedger('nonsense')).toEqual(emptyLedger());
		expect(parseLedger({ version: 9, months: {} })).toEqual(emptyLedger());
		const ledger = emptyLedger();
		addNote(ledger, '2026-11', 'OpenAI', 'm');
		const raw = JSON.parse(JSON.stringify(ledger)) as { months: Record<string, Record<string, unknown>> };
		(raw.months['2026-11'] as Record<string, unknown>).bad = { requests: 'x' };
		expect(parseLedger(raw)).toEqual(ledger);
	});
});
