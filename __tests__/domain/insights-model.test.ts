import { efficiencyFrontier, logScale, placeLabels } from '../../src/domain/chart-scales';
import {
	costPerThousandNotes,
	formatTokens,
	formatUsd,
	listInsightModels,
	modelChips,
	splitForChart,
} from '../../src/domain/insights-model';
import { getBundledCatalog } from '../../src/domain/model-catalog';
import type { ModelMeta } from '../../src/types/insights';

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

describe('costPerThousandNotes', () => {
	test('uses the assumed note size', () => {
		expect(costPerThousandNotes(meta())).toBeCloseTo((2500 * 1 + 120 * 2) / 1000);
	});
	test('local is free and anything without a public price has no cost', () => {
		expect(costPerThousandNotes(meta({ kind: 'local' }))).toBe(0);
		expect(costPerThousandNotes(meta({ kind: 'subscription' }))).toBeNull();
		expect(costPerThousandNotes(meta({ kind: 'unpriced' }))).toBeNull();
		expect(costPerThousandNotes(undefined)).toBeNull();
	});
});

describe('listInsightModels', () => {
	const rows = listInsightModels(
		[{ name: 'OpenAI', baseUrl: '', models: [{ id: 'gpt-6-luna', name: 'Mine (Decisions)', decision: true }] }],
		getBundledCatalog(),
		[{ provider: 'OpenAI', model: 'gpt-6-luna' }]
	);

	test('keeps one row per provider and model, preferring the configured name', () => {
		const luna = rows.filter((row) => row.provider === 'OpenAI' && row.id === 'gpt-6-luna');
		expect(luna).toHaveLength(1);
		expect(luna[0]).toMatchObject({ name: 'Mine', decision: true, inUse: true });
	});

	test('separates Decision models from Chat models', () => {
		const decision = rows.filter((row) => row.decision).map((row) => row.provider);
		expect(new Set(decision)).toEqual(new Set(['OpenAI', 'TypeSafe']));
		expect(rows.find((row) => row.id === 'claude-haiku-5-5')?.decision).toBe(false);
	});

	test('leaves subscription providers out until configured and sorts cheapest first', () => {
		expect(rows.some((row) => row.provider === 'Codex')).toBe(false);
		const costs = rows.flatMap((row) => (row.costPerThousandNotes === null ? [] : [row.costPerThousandNotes]));
		expect(costs).toEqual([...costs].sort((a, b) => a - b));
		expect(rows[rows.length - 1]?.costPerThousandNotes).toBeNull();
	});
});

describe('splitForChart', () => {
	test('plots only models with a positive cost and an index', () => {
		const row = {
			provider: 'p',
			name: 'n',
			decision: false,
			inUse: false,
			meta: meta(),
			costPerThousandNotes: 1,
		};
		const { plotted, notPlotted } = splitForChart([
			{ ...row, id: 'good' },
			{ ...row, id: 'free', costPerThousandNotes: 0 },
			{ ...row, id: 'no-price', costPerThousandNotes: null },
			{ ...row, id: 'no-index', meta: meta({ intelligenceIndex: null }) },
		]);
		expect(plotted.map((item) => item.id)).toEqual(['good']);
		expect(plotted[0]).toMatchObject({ x: 1, y: 50 });
		expect(notPlotted.map((item) => item.id)).toEqual(['free', 'no-price', 'no-index']);
	});
});

describe('display helpers', () => {
	test('formatUsd keeps small values readable', () => {
		expect(formatUsd(0)).toBe('$0');
		expect(formatUsd(0.0025)).toBe('$0.0025');
		expect(formatUsd(0.26)).toBe('$0.26');
		expect(formatUsd(12.5)).toBe('$12.50');
	});
	test('formatTokens shortens by size', () => {
		expect(formatTokens(1050000)).toBe('1.05M');
		expect(formatTokens(128000)).toBe('128K');
		expect(formatTokens(2500)).toBe('2.5K');
		expect(formatTokens(120)).toBe('120');
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
	test('labels do not cover a neighboring dot', () => {
		const labels = placeLabels(
			[
				{ id: 'near', text: 'Long model name', x: 150, y: 50 },
				{ id: 'dot', text: 'B', x: 190, y: 52 },
			],
			{ left: 0, right: 300, top: 0, bottom: 100 }
		);
		expect(labels.find((label) => label.id === 'near')?.anchor).toBe('end');
	});
});
