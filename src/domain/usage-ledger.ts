import type { DayUsage, TokenUsage, UsageLedger } from '../types/usage';

export const USAGE_WINDOW_DAYS = 30;
const MAX_LATENCIES = 20;

export interface ProviderUsageSummary {
	requests: number;
	tokens: number;
	/** Median of recent responses, so one slow request does not define the number. */
	recentLatencyMs: number | null;
}

export function emptyLedger(): UsageLedger {
	return { version: 2, days: {}, latencies: {} };
}

export function dayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

function windowStart(now: Date): string {
	return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - USAGE_WINDOW_DAYS + 1));
}

function totalTokens(usage: TokenUsage): number {
	return usage.inputTokens + usage.outputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
}

export function addLatency(ledger: UsageLedger, provider: string, latencyMs: number): void {
	if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
	const recent = (ledger.latencies[provider] ??= []);
	recent.push(Math.round(latencyMs));
	if (recent.length > MAX_LATENCIES) recent.shift();
}

export function addUsage(
	ledger: UsageLedger,
	now: Date,
	provider: string,
	usage: TokenUsage,
	latencyMs: number
): void {
	const start = windowStart(now);
	for (const day of Object.keys(ledger.days)) if (day < start) delete ledger.days[day];
	const entries = (ledger.days[dayKey(now)] ??= {});
	const total = (entries[provider] ??= { requests: 0, tokens: 0 });
	total.requests += 1;
	total.tokens += totalTokens(usage);
	addLatency(ledger, provider, latencyMs);
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function summarizeProvider(
	ledger: UsageLedger,
	now: Date,
	provider: string
): ProviderUsageSummary {
	const start = windowStart(now);
	const summary: ProviderUsageSummary = {
		requests: 0,
		tokens: 0,
		recentLatencyMs: median(ledger.latencies[provider] ?? []),
	};
	for (const [day, entries] of Object.entries(ledger.days)) {
		const total = entries[provider];
		if (day < start || !total) continue;
		summary.requests += total.requests;
		summary.tokens += total.tokens;
	}
	return summary;
}

function formatTokens(value: number): string {
	if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
	return String(value);
}

function formatLatency(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function usageChips(summary: ProviderUsageSummary): string[] {
	if (summary.requests === 0 && summary.recentLatencyMs === null) {
		return [`No requests in ${USAGE_WINDOW_DAYS} days`];
	}
	const chips = [
		`${formatTokens(summary.tokens)} tokens in ${USAGE_WINDOW_DAYS} days`,
		`${summary.requests} ${summary.requests === 1 ? 'request' : 'requests'}`,
	];
	if (summary.recentLatencyMs !== null) chips.push(`${formatLatency(summary.recentLatencyMs)} recent`);
	return chips;
}

function isDayUsage(value: unknown): value is DayUsage {
	if (typeof value !== 'object' || value === null) return false;
	const usage = value as Record<string, unknown>;
	return typeof usage.requests === 'number' && typeof usage.tokens === 'number';
}

/** The file lives on disk where Sync or a hand edit can damage it; unreadable data starts a new ledger. */
export function parseLedger(value: unknown): UsageLedger {
	const ledger = emptyLedger();
	if (typeof value !== 'object' || value === null) return ledger;
	const raw = value as { version?: unknown; days?: unknown; latencies?: unknown };
	if (raw.version !== 2) return ledger;
	for (const [day, entries] of Object.entries(raw.days ?? {})) {
		if (typeof entries !== 'object' || entries === null) continue;
		for (const [provider, usage] of Object.entries(entries as Record<string, unknown>)) {
			if (isDayUsage(usage)) (ledger.days[day] ??= {})[provider] = usage;
		}
	}
	for (const [provider, values] of Object.entries(raw.latencies ?? {})) {
		if (!Array.isArray(values)) continue;
		ledger.latencies[provider] = values.filter((item): item is number => typeof item === 'number');
	}
	return ledger;
}
