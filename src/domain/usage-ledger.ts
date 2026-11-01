import type { ModelMeta, TokenUsage, UsageBucket, UsageLedger } from '../types/insights';

const MAX_LATENCIES_PER_BUCKET = 50;
const MAX_MONTHS = 24;

export function emptyLedger(): UsageLedger {
	return { version: 1, months: {} };
}

export function monthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function bucketKey(provider: string, model: string): string {
	return `${provider}::${model}`;
}

function emptyBucket(): UsageBucket {
	return {
		requests: 0,
		notes: 0,
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		cacheWriteTokens: 0,
		latenciesMs: [],
	};
}

function bucketFor(ledger: UsageLedger, month: string, provider: string, model: string): UsageBucket {
	const entries = (ledger.months[month] ??= {});
	const months = Object.keys(ledger.months).sort();
	for (const old of months.slice(0, Math.max(0, months.length - MAX_MONTHS))) delete ledger.months[old];
	return (entries[bucketKey(provider, model)] ??= emptyBucket());
}

function pushLatency(bucket: UsageBucket, latencyMs: number): void {
	if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
	bucket.latenciesMs.push(Math.round(latencyMs));
	if (bucket.latenciesMs.length > MAX_LATENCIES_PER_BUCKET) bucket.latenciesMs.shift();
}

export function addUsage(
	ledger: UsageLedger,
	month: string,
	provider: string,
	model: string,
	usage: TokenUsage,
	latencyMs: number
): void {
	const bucket = bucketFor(ledger, month, provider, model);
	bucket.requests += 1;
	bucket.inputTokens += usage.inputTokens;
	bucket.outputTokens += usage.outputTokens;
	bucket.cachedInputTokens += usage.cachedInputTokens;
	bucket.cacheWriteTokens += usage.cacheWriteTokens;
	pushLatency(bucket, latencyMs);
}

/** Connection tests measure speed, but their tiny prompts must not skew tokens per note. */
export function addLatency(
	ledger: UsageLedger,
	month: string,
	provider: string,
	model: string,
	latencyMs: number
): void {
	pushLatency(bucketFor(ledger, month, provider, model), latencyMs);
}

export function addNote(ledger: UsageLedger, month: string, provider: string, model: string): void {
	bucketFor(ledger, month, provider, model).notes += 1;
}

function isBucket(value: unknown): value is UsageBucket {
	if (typeof value !== 'object' || value === null) return false;
	const bucket = value as Record<string, unknown>;
	return (
		['requests', 'notes', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteTokens'].every(
			(key) => typeof bucket[key] === 'number'
		) && Array.isArray(bucket.latenciesMs)
	);
}

/** The file lives on disk where Sync or a hand edit can damage it; unreadable data starts a new ledger. */
export function parseLedger(value: unknown): UsageLedger {
	if (typeof value !== 'object' || value === null) return emptyLedger();
	const raw = value as { version?: unknown; months?: unknown };
	if (raw.version !== 1 || typeof raw.months !== 'object' || raw.months === null) return emptyLedger();
	const ledger = emptyLedger();
	for (const [month, entries] of Object.entries(raw.months)) {
		if (typeof entries !== 'object' || entries === null) continue;
		for (const [key, bucket] of Object.entries(entries as Record<string, unknown>)) {
			if (isBucket(bucket)) (ledger.months[month] ??= {})[key] = bucket;
		}
	}
	return ledger;
}

export function usageCost(usage: TokenUsage, meta: ModelMeta | undefined): number | null {
	if (meta?.kind === 'local') return 0;
	if (meta?.kind !== 'priced' || meta.inputPerMTok === null || meta.outputPerMTok === null) return null;
	const input = meta.inputPerMTok;
	return (
		(usage.inputTokens * input +
			usage.cachedInputTokens * (meta.cacheReadPerMTok ?? input) +
			usage.cacheWriteTokens * (meta.cacheWritePerMTok ?? input) +
			usage.outputTokens * meta.outputPerMTok) /
		1e6
	);
}

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
