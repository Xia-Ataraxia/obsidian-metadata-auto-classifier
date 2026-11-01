import type { TokenUsage } from '../types/insights';

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function cachedDetail(details: unknown): number {
	return isRaw(details) ? count(details.cached_tokens) : 0;
}

/** OpenAI-style totals include cached tokens, so the full-price share is the difference. */
function split(total: number, cached: number, output: number, cacheWrite = 0): TokenUsage {
	return {
		inputTokens: Math.max(0, total - cached - cacheWrite),
		outputTokens: output,
		cachedInputTokens: cached,
		cacheWriteTokens: cacheWrite,
	};
}

function fromUsageObject(usage: Raw): TokenUsage | undefined {
	if ('prompt_tokens' in usage) {
		// DeepSeek reports prompt_cache_hit_tokens; OpenAI-compatible APIs use prompt_tokens_details.
		const cached = count(usage.prompt_cache_hit_tokens) || cachedDetail(usage.prompt_tokens_details);
		return split(count(usage.prompt_tokens), cached, count(usage.completion_tokens));
	}
	if ('input_tokens' in usage) {
		if ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage) {
			// Anthropic's input_tokens already excludes cached and cache-write tokens.
			return {
				inputTokens: count(usage.input_tokens),
				outputTokens: count(usage.output_tokens),
				cachedInputTokens: count(usage.cache_read_input_tokens),
				cacheWriteTokens: count(usage.cache_creation_input_tokens),
			};
		}
		// Responses, Decisions and System One totals include any cached tokens.
		return split(
			count(usage.input_tokens),
			cachedDetail(usage.input_tokens_details),
			count(usage.output_tokens)
		);
	}
	return undefined;
}

/** Reads token usage from any supported provider response; responses without usage yield no sample. */
export function parseUsage(data: unknown): TokenUsage | undefined {
	if (!isRaw(data)) return undefined;
	if (isRaw(data.usageMetadata)) {
		const meta = data.usageMetadata;
		return split(
			count(meta.promptTokenCount),
			count(meta.cachedContentTokenCount),
			count(meta.candidatesTokenCount)
		);
	}
	if ('prompt_eval_count' in data || 'eval_count' in data) {
		return split(count(data.prompt_eval_count), 0, count(data.eval_count));
	}
	return isRaw(data.usage) ? fromUsageObject(data.usage) : undefined;
}
