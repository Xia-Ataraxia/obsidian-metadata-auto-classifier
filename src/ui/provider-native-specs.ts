import { TAG_GENERATION_SCHEMA } from '../domain/constants';
import { CODEX_OAUTH } from '../domain/auth/oauth-constants';
import { TagGenerationError } from '../domain/tag-generation';
import { PROVIDER_NAMES } from '../utils/lib-utils';
import type { GeneratedTags, ProviderConfig } from '../types';
import type { SSEEvent, SSEEventOutcome } from './streaming-request';
import { parseTagsJson } from './provider-chat-specs';
import type { ProviderSpec } from './provider-chat-specs';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function parseGeminiResponse(data: unknown): GeneratedTags {
	if (!isRecord(data) || !Array.isArray(data.candidates) || data.candidates.length !== 1) {
		throw new TagGenerationError('invalid-response');
	}
	if (isRecord(data.promptFeedback) && data.promptFeedback.blockReason) {
		throw new TagGenerationError('invalid-response');
	}
	const candidate: unknown = data.candidates[0];
	if (!isRecord(candidate) || candidate.finishReason !== 'STOP' || !isRecord(candidate.content)) {
		throw new TagGenerationError('invalid-response');
	}
	if (!Array.isArray(candidate.content.parts)) throw new TagGenerationError('invalid-response');
	const parts: unknown[] = candidate.content.parts;
	const text: string[] = [];
	for (const part of parts) {
		if (!isRecord(part)) throw new TagGenerationError('invalid-response');
		if (part.thought === true) continue;
		if (typeof part.text !== 'string') throw new TagGenerationError('invalid-response');
		text.push(part.text);
	}
	return parseTagsJson(text.join(''));
}

function parseOllamaResponse(data: unknown): GeneratedTags {
	if (
		!isRecord(data) ||
		data.done !== true ||
		data.done_reason !== 'stop' ||
		!isRecord(data.message)
	) {
		throw new TagGenerationError('invalid-response');
	}
	return parseTagsJson(data.message.content);
}

function extractOAuthTokens(provider: ProviderConfig): ProviderConfig['oauth'] {
	if (provider.auth) return provider.auth.type === 'oauth' ? provider.auth.oauth : undefined;
	if (provider.authType === 'apiKey') return undefined;
	return provider.oauth;
}

function codexHeaders(_apiKey: string, provider?: ProviderConfig): Record<string, string> {
	const oauth = provider && extractOAuthTokens(provider);
	if (!oauth?.accessToken || !oauth.accountId)
		throw new Error('Codex authentication is unavailable');
	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${oauth.accessToken}`,
		'ChatGPT-Account-Id': oauth.accountId,
	};
}

function containsRefusal(output: unknown): boolean {
	return (
		Array.isArray(output) &&
		output.some(
			(item) =>
				isRecord(item) &&
				(item.type === 'refusal' ||
					(Array.isArray(item.content) &&
						item.content.some((part) => isRecord(part) && part.type === 'refusal')))
		)
	);
}

function parseCodexResponse(data: unknown): GeneratedTags {
	if (!isRecord(data) || data.status !== 'completed' || !Array.isArray(data.output)) {
		throw new TagGenerationError('invalid-response');
	}
	if (containsRefusal(data.output)) throw new TagGenerationError('invalid-response');
	const text = data.output
		.filter((item) => isRecord(item) && item.type === 'message' && Array.isArray(item.content))
		.flatMap((item) => (item as Record<string, unknown>).content as unknown[])
		.filter((part) => isRecord(part) && part.type === 'output_text')
		.map((part) => (part as Record<string, unknown>).text)
		.join('');
	return parseTagsJson(text);
}

function parseCodexEvent(event: SSEEvent): SSEEventOutcome {
	if (event.type === 'response.output_text.delta') {
		return typeof event.delta === 'string'
			? { type: 'delta', text: event.delta }
			: { type: 'error' };
	}
	if (event.type === 'response.completed') {
		const response = event.response;
		if (
			!isRecord(response) ||
			response.status !== 'completed' ||
			!Array.isArray(response.output) ||
			containsRefusal(response.output)
		) {
			return { type: 'error' };
		}
		return { type: 'complete' };
	}
	if (
		event.type === 'error' ||
		event.type === 'response.failed' ||
		event.type === 'response.incomplete' ||
		event.type === 'response.error' ||
		event.type.startsWith('response.refusal.') ||
		(event.type === 'response.output_item.done' && containsRefusal([event.item]))
	) {
		return { type: 'error' };
	}
	return { type: 'ignore' };
}

export const nativeProviderSpecs: Record<string, ProviderSpec> = {
	[PROVIDER_NAMES.GEMINI]: {
		buildHeaders: () => ({ 'Content-Type': 'application/json' }),
		buildRequestBody: (systemRole, userPrompt, _model, temperature) => ({
			contents: [{ parts: [{ text: `${systemRole}\n\n${userPrompt}` }] }],
			generationConfig: {
				temperature,
				responseMimeType: 'application/json',
				responseJsonSchema: TAG_GENERATION_SCHEMA,
			},
		}),
		buildUrl: (baseUrl, model, apiKey) =>
			`${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
		parseResponse: parseGeminiResponse,
	},
	[PROVIDER_NAMES.OLLAMA]: {
		buildHeaders: (apiKey) => {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
			return headers;
		},
		buildRequestBody: (systemRole, userPrompt, model, temperature) => ({
			model,
			messages: [
				{ role: 'system', content: systemRole },
				{ role: 'user', content: userPrompt },
			],
			options: { temperature },
			stream: false,
			format: TAG_GENERATION_SCHEMA,
		}),
		buildUrl: (baseUrl) => baseUrl,
		parseResponse: parseOllamaResponse,
	},
	[PROVIDER_NAMES.CODEX]: {
		requiresStreaming: true,
		buildHeaders: codexHeaders,
		buildRequestBody: (systemRole, userPrompt, model) => ({
			model,
			instructions: systemRole,
			input: [{ role: 'user', content: [{ type: 'input_text', text: userPrompt }] }],
			stream: true,
			store: false,
			text: {
				format: {
					type: 'json_schema',
					name: 'generated_tags',
					strict: true,
					schema: TAG_GENERATION_SCHEMA,
				},
			},
		}),
		buildUrl: () => CODEX_OAUTH.API_ENDPOINT,
		parseResponse: parseCodexResponse,
		parseStreamEvent: parseCodexEvent,
		parseStreamResponse: parseTagsJson,
	},
};
