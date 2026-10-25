import {
	ANTHROPIC_TOOL_CONFIG,
	COMMON_CONSTANTS,
	GEMINI_STRUCTURE_OUTPUT,
	OLLAMA_STRUCTURE_OUTPUT,
	OPENAI_STRUCTURE_OUTPUT,
} from '../domain/constants';
import { PROVIDER_NAMES } from '../utils/lib-utils';
import type {
	APIProvider,
	ProviderConfig,
	StructuredOutput,
	OnTokenRefreshCallback,
} from '../types';
import { sendRequest, sendStreamingRequest, HttpError, type SSEEvent } from './request';
import { CODEX_OAUTH } from '../domain/auth/oauth-constants';
import { CodexOAuth } from './auth/oauth';
import { macLogger } from '../utils/mac-logger';

const parseJsonResponse = (content: string, providerName: string): StructuredOutput => {
	try {
		const result = JSON.parse(content.trim()) as Partial<StructuredOutput>;
		if (!Array.isArray(result.output) || typeof result.reliability !== 'number') {
			throw new Error('Invalid response structure: missing output array or reliability number');
		}
		return {
			output: result.output,
			reliability: result.reliability,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse ${providerName} response: ${message}. Raw content: ${content.substring(0, 200)}`
		);
	}
};

interface CodexOutputItem {
	type: string;
	content?: Array<{ type: string; text?: string }>;
}

interface APIResponseData {
	content?: Array<{ input?: { output?: StructuredOutput['output']; reliability?: number } }>;
	candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
	message?: { content?: string };
	choices?: Array<{ message?: { content?: string } }>;
	output?: CodexOutputItem[];
}

type RequestBody = Record<string, unknown>;

function extractOAuthTokens(provider: ProviderConfig) {
	if (provider.auth?.type === 'oauth') {
		return provider.auth.oauth;
	}
	return provider.oauth;
}

interface ProviderSpec {
	buildHeaders: (apiKey: string, provider?: ProviderConfig) => Record<string, string>;
	buildRequestBody: (
		systemRole: string,
		userPrompt: string,
		model: string,
		temperature?: number
	) => RequestBody;
	buildUrl: (baseUrl: string, model: string, apiKey: string) => string;
	parseResponse: (data: APIResponseData) => StructuredOutput;
	// Streaming support for providers that require it (e.g., Codex)
	requiresStreaming?: boolean;
	parseStreamEvent?: (event: SSEEvent) => string | null;
	// For streaming providers, parseResponse receives accumulated text string
	parseStreamResponse?: (text: string) => StructuredOutput;
}

export class UnifiedProvider implements APIProvider {
	private specs: Record<string, ProviderSpec> = {
		[PROVIDER_NAMES.ANTHROPIC]: {
			buildHeaders: (apiKey: string) => ({
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
				tools: [ANTHROPIC_TOOL_CONFIG],
				tool_choice: { type: 'tool', name: 'classify_content' },
			}),
			buildUrl: (baseUrl) => baseUrl,
			parseResponse: (data) => {
				const result = data?.content?.[0];
				if (!result?.input) {
					throw new Error('Anthropic response missing tool use content');
				}
				return {
					output: result.input.output ?? [],
					reliability: result.input.reliability ?? 0,
				};
			},
		},
		[PROVIDER_NAMES.GEMINI]: {
			buildHeaders: () => ({
				'Content-Type': 'application/json',
			}),
			buildRequestBody: (systemRole, userPrompt, _, temperature) => ({
				contents: [
					{
						parts: [{ text: `${systemRole}\n\n${userPrompt}` }],
					},
				],
				generationConfig: {
					temperature,
					...GEMINI_STRUCTURE_OUTPUT,
				},
			}),
			buildUrl: (baseUrl, model, apiKey) =>
				`${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
			parseResponse: (data) => {
				const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
				if (!content) {
					throw new Error('Gemini response missing content');
				}
				return parseJsonResponse(content, 'Gemini');
			},
		},
		[PROVIDER_NAMES.OLLAMA]: {
			buildHeaders: (apiKey: string) => {
				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
				};
				if (apiKey) {
					headers.Authorization = `Bearer ${apiKey}`;
				}
				return headers;
			},
			buildRequestBody: (systemRole, userPrompt, model, temperature) => ({
				model,
				messages: [
					{ role: 'system', content: systemRole },
					{ role: 'user', content: userPrompt },
				],
				temperature,
				stream: false,
				format: OLLAMA_STRUCTURE_OUTPUT,
			}),
			buildUrl: (baseUrl) => baseUrl,
			parseResponse: (data) => {
				const content = data?.message?.content;
				if (!content) {
					throw new Error('Ollama response missing content');
				}
				return parseJsonResponse(content, 'Ollama');
			},
		},
		[PROVIDER_NAMES.OPENROUTER]: {
			buildHeaders: (apiKey: string) => ({
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'X-Title': 'Metadata Auto Classifier',
			}),
			buildRequestBody: (systemRole, userPrompt, model, temperature) => ({
				model,
				messages: [
					{ role: 'system', content: systemRole },
					{ role: 'user', content: userPrompt },
				],
				temperature,
				response_format: OPENAI_STRUCTURE_OUTPUT,
			}),
			buildUrl: (baseUrl) => baseUrl,
			parseResponse: (data) => {
				const content = data?.choices?.[0]?.message?.content;
				if (!content) {
					throw new Error('OpenRouter response missing content');
				}
				return parseJsonResponse(content, 'OpenRouter');
			},
		},
		[PROVIDER_NAMES.CODEX]: {
			requiresStreaming: true,

			buildHeaders: (_apiKey: string, provider?: ProviderConfig) => {
				if (!provider) {
					throw new Error('Codex requires provider config for OAuth tokens');
				}
				const oauth = extractOAuthTokens(provider);
				if (!oauth?.accessToken || !oauth?.accountId) {
					throw new Error(
						'Codex OAuth tokens incomplete. Please reconnect your account in settings.'
					);
				}
				return {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${oauth.accessToken}`,
					'ChatGPT-Account-Id': oauth.accountId,
				};
			},

			// Codex Responses API does not support temperature
			buildRequestBody: (systemRole, userPrompt, model) => ({
				model,
				instructions: systemRole,
				input: [
					{
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: userPrompt,
							},
						],
					},
				],
				stream: true, // Required for Codex API
				store: false,
			}),

			buildUrl: () => CODEX_OAUTH.API_ENDPOINT,

			// Parse SSE events from Codex streaming response
			parseStreamEvent: (event: SSEEvent) => {
				if (event.type === 'response.output_text.delta') {
					return (event.delta as string) ?? null;
				}
				if (event.type === 'error') {
					const errMsg = typeof event.message === 'string' ? event.message : JSON.stringify(event);
					throw new Error(`Codex stream error: ${errMsg}`);
				}
				return null;
			},

			// Parse the accumulated text from streaming response
			parseStreamResponse: (text: string) => {
				return parseJsonResponse(text, 'Codex');
			},

			// Fallback parseResponse (kept for tests, not used in production since Codex uses streaming)
			parseResponse: (data) => {
				const output = data?.output;
				if (!output || !Array.isArray(output)) {
					throw new Error('Codex response missing output array');
				}

				const messageItem = output.find((item) => item.type === 'message');
				if (!messageItem?.content) {
					throw new Error('Codex response missing message content');
				}

				const textContent = messageItem.content.find(
					(c) => c.type === 'output_text'
				);
				if (!textContent?.text) {
					throw new Error('Codex response missing text content');
				}

				return parseJsonResponse(textContent.text, 'Codex');
			},
		},
	};

	// Default spec for OpenAI, DeepSeek, LMStudio, Custom
	private defaultSpec: ProviderSpec = {
		buildHeaders: (apiKey: string) => ({
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		}),
		buildRequestBody: (systemRole, userPrompt, model, temperature) => ({
			model,
			messages: [
				{ role: 'system', content: systemRole },
				{ role: 'user', content: userPrompt },
			],
			temperature,
			response_format: OPENAI_STRUCTURE_OUTPUT,
		}),
		buildUrl: (baseUrl) => baseUrl,
		parseResponse: (data) => {
			const content = data?.choices?.[0]?.message?.content;
			if (!content) {
				throw new Error('API response missing content');
			}
			return parseJsonResponse(content, 'API');
		},
	};

	private getSpec(providerName: string): ProviderSpec {
		return this.specs[providerName] || this.defaultSpec;
	}

	buildHeaders(apiKey: string, providerName?: string): Record<string, string> {
		const spec = this.getSpec(providerName || '');
		return spec.buildHeaders(apiKey);
	}

	/**
	 * Extract API key from provider config (supports both new auth field and legacy apiKey)
	 */
	private getApiKey(provider: ProviderConfig): string {
		// New unified auth format
		if (provider.auth?.type === 'apiKey') {
			return provider.auth.apiKey;
		}
		// Legacy format
		return provider.apiKey ?? '';
	}

	async callAPI(
		systemRole: string,
		userPrompt: string,
		provider: ProviderConfig,
		selectedModel: string,
		temperature?: number,
		onTokenRefresh?: OnTokenRefreshCallback
	): Promise<StructuredOutput> {
		const spec = this.getSpec(provider.name);
		const apiKey = this.getApiKey(provider);

		const headers = spec.buildHeaders(apiKey, provider);
		const body = spec.buildRequestBody(
			systemRole,
			userPrompt,
			selectedModel,
			provider.temperature ?? temperature
		);
		const url = spec.buildUrl(provider.baseUrl, selectedModel, apiKey);

		// Use streaming for providers that require it (e.g., Codex)
		if (spec.requiresStreaming && spec.parseStreamEvent && spec.parseStreamResponse) {
			try {
				const accumulatedText = await sendStreamingRequest(
					url,
					headers,
					body,
					spec.parseStreamEvent
				);
				return spec.parseStreamResponse(accumulatedText);
			} catch (error) {
				// Handle 401 for Codex: attempt token refresh and retry
				const isCodex401 =
					error instanceof HttpError &&
					error.status === 401 &&
					provider.name === PROVIDER_NAMES.CODEX;

				if (isCodex401) {
					macLogger.info('[Codex] 401 received, attempting token refresh...');
					return this.refreshCodexTokensAndRetry(
						provider,
						systemRole,
						userPrompt,
						selectedModel,
						temperature,
						onTokenRefresh
					);
				}
				throw error;
			}
		}

		// Standard non-streaming request for other providers
		const response = await sendRequest(url, headers, body);
		return this.processApiResponse(response as APIResponseData, provider.name);
	}

	private async refreshCodexTokensAndRetry(
		provider: ProviderConfig,
		systemRole: string,
		userPrompt: string,
		selectedModel: string,
		temperature?: number,
		onTokenRefresh?: OnTokenRefreshCallback
	): Promise<StructuredOutput> {
		const oauth = extractOAuthTokens(provider);
		if (!oauth) {
			throw new Error('Codex OAuth tokens not found. Please reconnect your account.');
		}

		const codexOAuth = new CodexOAuth();
		const newTokens = await codexOAuth.refreshTokens(oauth);
		macLogger.info('[Codex] Tokens refreshed successfully');

		const updatedProvider: ProviderConfig = {
			...provider,
			auth: { type: 'oauth', oauth: newTokens },
			oauth: newTokens,
		};

		if (onTokenRefresh) {
			await onTokenRefresh(newTokens);
		}

		// Retry the streaming request with refreshed tokens
		const spec = this.getSpec(provider.name);
		if (!spec.parseStreamEvent || !spec.parseStreamResponse) {
			throw new Error('Codex spec is missing stream handlers');
		}

		const headers = spec.buildHeaders('', updatedProvider);
		const body = spec.buildRequestBody(
			systemRole,
			userPrompt,
			selectedModel,
			provider.temperature ?? temperature
		);
		const url = spec.buildUrl(provider.baseUrl, selectedModel, '');

		const accumulatedText = await sendStreamingRequest(url, headers, body, spec.parseStreamEvent);
		return spec.parseStreamResponse(accumulatedText);
	}

	processApiResponse(responseData: APIResponseData, providerName?: string): StructuredOutput {
		const spec = this.getSpec(providerName || '');
		return spec.parseResponse(responseData);
	}
}
