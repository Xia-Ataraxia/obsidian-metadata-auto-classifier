/** priced: per-token API billing. local: runs on the user's machine. subscription: billed by a plan. unpriced: no public price. */
export type ModelKind = 'priced' | 'local' | 'subscription' | 'unpriced';

export interface ModelMeta {
	kind: ModelKind;
	inputPerMTok: number | null;
	outputPerMTok: number | null;
	cacheReadPerMTok: number | null;
	cacheWritePerMTok: number | null;
	contextTokens: number | null;
	maxOutputTokens: number | null;
	knowledge: string | null;
	intelligenceIndex: number | null;
}

export interface ModelCatalog {
	schemaVersion: 1;
	generatedAt: string;
	sources: string[];
	/** Provider display name -> model id -> metadata. */
	models: Record<string, Record<string, ModelMeta>>;
}

/** `inputTokens` holds only tokens billed at the full input price; cached and cache-write tokens are separate. */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheWriteTokens: number;
}

export interface UsageBucket extends TokenUsage {
	requests: number;
	notes: number;
	latenciesMs: number[];
}

export interface UsageLedger {
	version: 1;
	/** `YYYY-MM` -> `provider::model` -> totals. */
	months: Record<string, Record<string, UsageBucket>>;
}

export type UsageCallback = (usage: TokenUsage, latencyMs: number) => void;

export interface UsageSink {
	record(provider: string, model: string, usage: TokenUsage, latencyMs: number): void;
	recordLatency(provider: string, model: string, latencyMs: number): void;
	noteClassified(provider: string, model: string): void;
}
