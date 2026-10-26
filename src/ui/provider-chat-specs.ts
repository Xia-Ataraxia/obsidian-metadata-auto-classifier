import { COMMON_CONSTANTS } from '../domain/constants';
import { TagGenerationError } from '../domain/tag-generation';
import { PROVIDER_NAMES } from '../utils/lib-utils';
import type { ProviderConfig, StructuredFormat } from '../types';
import type { SSEEvent, SSEEventOutcome } from './streaming-request';

export type ProviderRequestBody = Record<string, unknown>;

export interface ProviderSpec {
	buildHeaders: (apiKey: string, provider?: ProviderConfig) => Record<string, string>;
	buildRequestBody: (
		systemRole: string,
		userPrompt: string,
		model: string,
		temperature: number | undefined,
		format: StructuredFormat
	) => ProviderRequestBody;
	buildUrl: (baseUrl: string, model: string, apiKey: string) => string;
	/** Returns the parsed structured output; callers validate its shape. */
	parseResponse: (data: unknown, format: StructuredFormat) => unknown;
	requiresStreaming?: boolean;
	parseStreamEvent?: (event: SSEEvent) => SSEEventOutcome;
	parseStreamResponse?: (text: string) => unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseJsonText(content: unknown): unknown {
	if (typeof content !== 'string') throw new TagGenerationError('invalid-response');
	try {
		return JSON.parse(content) as unknown;
	} catch {
		throw new TagGenerationError('invalid-response');
	}
}

function parseChatCompletion(data: unknown): unknown {
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
	return parseJsonText(choice.message.content);
}

function openAIHeaders(apiKey: string): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	return headers;
}

function openAIRequestBody(
	systemRole: string,
	userPrompt: string,
	model: string,
	temperature: number | undefined,
	format: StructuredFormat
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
			json_schema: { name: format.name, strict: true, schema: format.schema },
		},
	};
}

function deepSeekRequestBody(
	systemRole: string,
	userPrompt: string,
	model: string,
	temperature: number | undefined,
	format: StructuredFormat
): ProviderRequestBody {
	return {
		model,
		messages: [
			{
				role: 'system',
				content: `${systemRole}\n\nReturn only JSON that matches this JSON schema: ${JSON.stringify(format.schema)}`,
			},
			{ role: 'user', content: userPrompt },
		],
		temperature,
		response_format: { type: 'json_object' },
	};
}

function parseAnthropicResponse(data: unknown, format: StructuredFormat): unknown {
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
	if (tools.length !== 1 || !isRecord(tool) || tool.name !== format.name)
		throw new TagGenerationError('invalid-response');
	return tool.input;
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
		buildRequestBody: (systemRole, userPrompt, model, temperature, format) => ({
			...openAIRequestBody(systemRole, userPrompt, model, temperature, format),
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
		buildRequestBody: (systemRole, userPrompt, model, temperature, format) => ({
			model,
			max_tokens: COMMON_CONSTANTS.DEFAULT_MAX_TOKENS,
			system: systemRole,
			messages: [{ role: 'user', content: userPrompt }],
			temperature,
			tools: [
				{
					name: format.name,
					description: 'Return the requested structured result.',
					input_schema: format.schema,
					strict: true,
				},
			],
			tool_choice: {
				type: 'tool',
				name: format.name,
				disable_parallel_tool_use: true,
			},
		}),
		buildUrl: (baseUrl) => baseUrl,
		parseResponse: parseAnthropicResponse,
	},
};
