import { parseUsage } from '../../src/domain/usage-parsers';

describe('parseUsage', () => {
	test.each([
		[
			'OpenAI chat counts cached tokens inside prompt_tokens',
			{ usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } },
			{ inputTokens: 60, outputTokens: 10, cachedInputTokens: 40, cacheWriteTokens: 0 },
		],
		[
			'DeepSeek reports cache hits separately',
			{ usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 70 } },
			{ inputTokens: 30, outputTokens: 10, cachedInputTokens: 70, cacheWriteTokens: 0 },
		],
		[
			'Anthropic input excludes cached and written tokens',
			{
				usage: {
					input_tokens: 5,
					output_tokens: 10,
					cache_read_input_tokens: 40,
					cache_creation_input_tokens: 20,
				},
			},
			{ inputTokens: 5, outputTokens: 10, cachedInputTokens: 40, cacheWriteTokens: 20 },
		],
		[
			'Responses and Decisions totals include cached tokens',
			{ usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 25 } } },
			{ inputTokens: 75, outputTokens: 10, cachedInputTokens: 25, cacheWriteTokens: 0 },
		],
		[
			'System One',
			{ usage: { input_tokens: 120, output_tokens: 12 } },
			{ inputTokens: 120, outputTokens: 12, cachedInputTokens: 0, cacheWriteTokens: 0 },
		],
		[
			'Gemini',
			{ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, cachedContentTokenCount: 30 } },
			{ inputTokens: 70, outputTokens: 10, cachedInputTokens: 30, cacheWriteTokens: 0 },
		],
		[
			'Ollama',
			{ prompt_eval_count: 100, eval_count: 10 },
			{ inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0 },
		],
	])('%s', (_name, response, expected) => {
		expect(parseUsage(response)).toEqual(expected);
	});

	test('responses without usage yield no sample', () => {
		expect(parseUsage({ choices: [] })).toBeUndefined();
		expect(parseUsage('text')).toBeUndefined();
		expect(parseUsage({ usage: { total: 3 } })).toBeUndefined();
	});
});
