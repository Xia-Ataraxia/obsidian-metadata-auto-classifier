import { TAG_GENERATION_SCHEMA, COMMON_CONSTANTS } from '../domain/constants';
import { parseGeneratedTags, TagGenerationError } from '../domain/tag-generation';
import { PROVIDER_NAMES } from '../utils/lib-utils';
import type { GeneratedTags, ProviderConfig } from '../types';
import type { SSEEvent, SSEEventOutcome } from './streaming-request';

export type ProviderRequestBody = Record<string, unknown>;

export interface ProviderSpec {
	buildHeaders: (apiKey: string, provider?: ProviderConfig) => Record<string, string>;
	buildRequestBody: (
		systemRole: string,
		userPrompt: string,
		model: string,
		temperature?: number
	) => ProviderRequestBody;
	buildUrl: (baseUrl: string, model: string, apiKey: string) => string;
	parseResponse: (data: unknown) => GeneratedTags;
	requiresStreaming?: boolean;
	parseStreamEvent?: (event: SSEEvent) => SSEEventOutcome;
	parseStreamResponse?: (text: string) => GeneratedTags;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseTagsJson(content: unknown): GeneratedTags {
	if (typeof content !== 'string') throw new TagGenerationError('invalid-response');
	let parsed: unknown;
	try {
		parsed = JSON.parse(content) as unknown;
	} catch {
		throw new TagGenerationError('invalid-response');
	}
	return parseGeneratedTags(parsed);
}

function parseChatCompletion(data: unknown): GeneratedTags {
	if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length !== 1) {
		throw new TagGenerationError('invalid-response');
	}
	const choice: unknown = data.choices[0];
	if (
		!isRecord(choice) ||
		choice.finish_reason !== 'stop' ||
		!isRecord(choice.message) ||
		choice.message.refusal != null
	) {
		throw new TagGenerationError('invalid-response');
	}
	return parseTagsJson(choice.message.content);
}

function openAIHeaders(apiKey: string): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${apiKey}`,
	};
}

function openAIRequestBody(
	systemRole: string,
	userPrompt: string,
	model: string,
	temperature?: number
): ProviderRequestBody {
	return {
		model,
		messages: [
			{ role: 'system', content: systemRole },
			{ role: 'user', content: userPrompt },
		],
		temperature,
		response_format: {
			type: 'json_schema',
			json_schema: { name: 'generated_tags', strict: true, schema: TAG_GENERATION_SCHEMA },
		},
	};
}

function deepSeekRequestBody(
	systemRole: string,
	userPrompt: string,
	model: string,
	temperature?: number
): ProviderRequestBody {
	return {
		model,
		messages: [
			{
				role: 'system',
				content: `${systemRole}\n\nReturn only JSON with exactly one property named "tags", whose value is an array of strings. Example: {"tags": ["tag1"]}.`,
			},
			{ role: 'user', content: userPrompt },
		],
		temperature,
		response_format: { type: 'json_object' },
	};
}

const anthropicTool = {
	name: 'generate_tags',
	description: 'Return only newly generated Obsidian tags.',
	input_schema: TAG_GENERATION_SCHEMA,
	strict: true,
} as const;

function parseAnthropicResponse(data: unknown): GeneratedTags {
	if (!isRecord(data) || data.stop_reason !== 'tool_use' || !Array.isArray(data.content)) {
		throw new TagGenerationError('invalid-response');
	}
	if (data.content.some((part) => isRecord(part) && part.type === 'refusal')) {
		throw new TagGenerationError('invalid-response');
	}
	const tools: unknown[] = data.content.filter(
		(part) => isRecord(part) && part.type === 'tool_use'
	);
	const tool = tools[0];
	if (tools.length !== 1 || !isRecord(tool) || tool.name !== anthropicTool.name)
		throw new TagGenerationError('invalid-response');
	return parseGeneratedTags(tool.input);
}

const openAICompatible = (): ProviderSpec => ({
	buildHeaders: openAIHeaders,
	buildRequestBody: openAIRequestBody,
	buildUrl: (baseUrl) => baseUrl,
	parseResponse: parseChatCompletion,
});

export const chatProviderSpecs: Record<string, ProviderSpec> = {
	[PROVIDER_NAMES.OPENAI]: openAICompatible(),
	[PROVIDER_NAMES.DEEPSEEK]: {
		...openAICompatible(),
		buildRequestBody: deepSeekRequestBody,
	},
	[PROVIDER_NAMES.LMSTUDIO]: openAICompatible(),
	[PROVIDER_NAMES.CUSTOM]: openAICompatible(),
	[PROVIDER_NAMES.OPENROUTER]: {
		...openAICompatible(),
		buildRequestBody: (systemRole, userPrompt, model, temperature) => ({
			...openAIRequestBody(systemRole, userPrompt, model, temperature),
			provider: { require_parameters: true },
		}),
		buildHeaders: (apiKey) => ({
			...openAIHeaders(apiKey),
			'X-Title': 'Metadata Auto Classifier',
		}),
	},
	[PROVIDER_NAMES.ANTHROPIC]: {
		buildHeaders: (apiKey) => ({
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
		}),
		buildRequestBody: (systemRole, userPrompt, model, temperature) => ({
			model,
			max_tokens: COMMON_CONSTANTS.DEFAULT_MAX_TOKENS,
			system: systemRole,
			messages: [{ role: 'user', content: userPrompt }],
			temperature,
			tools: [anthropicTool],
			tool_choice: {
				type: 'tool',
				name: anthropicTool.name,
				disable_parallel_tool_use: true,
			},
		}),
		buildUrl: (baseUrl) => baseUrl,
		parseResponse: parseAnthropicResponse,
	},
};
