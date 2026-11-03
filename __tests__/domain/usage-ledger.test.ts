import {
	addLatency,
	addUsage,
	dayKey,
	emptyLedger,
	parseLedger,
	summarizeProvider,
	usageChips,
} from '../../src/domain/usage-ledger';

const tokens = { inputTokens: 100, outputTokens: 20, cachedInputTokens: 30, cacheWriteTokens: 5 };
const now = new Date(2026, 10, 15, 12);

describe('usage ledger', () => {
	test('sums requests and all token kinds per provider', () => {
		const ledger = emptyLedger();
		addUsage(ledger, now, 'OpenAI', tokens, 1000);
		addUsage(ledger, now, 'OpenAI', tokens, 3000);
		addUsage(ledger, now, 'Anthropic', tokens, 500);
		expect(summarizeProvider(ledger, now, 'OpenAI')).toEqual({
			requests: 2,
			tokens: 310,
			recentLatencyMs: 2000,
		});
		expect(summarizeProvider(ledger, now, 'Anthropic').requests).toBe(1);
	});

	test('drops days older than the window, keeping the 30th day', () => {
		const ledger = emptyLedger();
		addUsage(ledger, new Date(2026, 9, 17, 12), 'OpenAI', tokens, 100);
		addUsage(ledger, new Date(2026, 9, 16, 12), 'OpenAI', tokens, 100);
		expect(summarizeProvider(ledger, now, 'OpenAI').requests).toBe(1);
		addUsage(ledger, now, 'OpenAI', tokens, 100);
		expect(Object.keys(ledger.days)).toEqual([dayKey(new Date(2026, 9, 17)), dayKey(now)]);
	});

	test('connection tests add a response time without counting as usage', () => {
		const ledger = emptyLedger();
		addLatency(ledger, 'OpenAI', 800);
		expect(summarizeProvider(ledger, now, 'OpenAI')).toEqual({
			requests: 0,
			tokens: 0,
			recentLatencyMs: 800,
		});
	});

	test('keeps only the most recent response times', () => {
		const ledger = emptyLedger();
		for (let index = 0; index < 25; index++) addLatency(ledger, 'OpenAI', index);
		expect(ledger.latencies.OpenAI).toHaveLength(20);
		expect(ledger.latencies.OpenAI?.[0]).toBe(5);
	});

	test('chips describe usage and the empty state', () => {
		expect(usageChips({ requests: 0, tokens: 0, recentLatencyMs: null })).toEqual([
			'No requests in 30 days',
		]);
		expect(usageChips({ requests: 1, tokens: 900, recentLatencyMs: 640 })).toEqual([
			'900 tokens in 30 days',
			'1 request',
			'640 ms recent',
		]);
		expect(usageChips({ requests: 42, tokens: 1_250_000, recentLatencyMs: 1234 })).toEqual([
			'1.3M tokens in 30 days',
			'42 requests',
			'1.2 s recent',
		]);
	});

	test('damaged or older files start a new ledger and keep what is valid', () => {
		expect(parseLedger(null)).toEqual(emptyLedger());
		expect(parseLedger({ version: 1, months: {} })).toEqual(emptyLedger());
		expect(
			parseLedger({
				version: 2,
				days: { '2026-11-15': { OpenAI: { requests: 1, tokens: 5 }, Bad: { requests: 'x' } }, bad: 3 },
				latencies: { OpenAI: [1, 'x', 2], Bad: 4 },
			})
		).toEqual({
			version: 2,
			days: { '2026-11-15': { OpenAI: { requests: 1, tokens: 5 } } },
			latencies: { OpenAI: [1, 2] },
		});
	});
});
