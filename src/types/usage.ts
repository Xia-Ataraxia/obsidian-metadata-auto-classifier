/** `inputTokens` holds only tokens billed at the full input price; cached and cache-write tokens are separate. */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheWriteTokens: number;
}

export interface DayUsage {
	requests: number;
	tokens: number;
}

export interface UsageLedger {
	version: 2;
	/** `YYYY-MM-DD` -> provider -> totals. */
	days: Record<string, Record<string, DayUsage>>;
	/** Provider -> most recent response times in milliseconds, oldest first. */
	latencies: Record<string, number[]>;
}

export type UsageCallback = (usage: TokenUsage, latencyMs: number) => void;

export interface UsageSink {
	record(provider: string, usage: TokenUsage, latencyMs: number): void;
	recordLatency(provider: string, latencyMs: number): void;
}
