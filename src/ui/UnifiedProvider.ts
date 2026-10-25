import { PROVIDER_NAMES } from '../utils/lib-utils';
import type { APIProvider, GeneratedTags, OnTokenRefreshCallback, ProviderConfig } from '../types';
import { HttpError, sendRequest } from './request';
import { sendStreamingRequest } from './streaming-request';
import type { HttpRequestOptions } from './request';
import { CodexOAuth } from './auth/oauth';
import { chatProviderSpecs } from './provider-chat-specs';
import type { ProviderSpec } from './provider-chat-specs';
import { nativeProviderSpecs } from './provider-native-specs';

const REQUEST_TIMEOUT_MS = 60_000;

function extractOAuthTokens(provider: ProviderConfig) {
	return provider.auth?.type === 'oauth' ? provider.auth.oauth : provider.oauth;
}

function getProviderSpec(providerName: string): ProviderSpec {
	const spec = Object.prototype.hasOwnProperty.call(chatProviderSpecs, providerName)
		? chatProviderSpecs[providerName]
		: Object.prototype.hasOwnProperty.call(nativeProviderSpecs, providerName)
			? nativeProviderSpecs[providerName]
			: undefined;
	if (!spec) throw new Error('Unsupported provider');
	return spec;
}

function requestOptionsWithDeadline(options?: HttpRequestOptions): HttpRequestOptions {
	const startedAt = Date.now();
	return {
		...options,
		deadline: Math.min(
			options?.deadline ?? startedAt + REQUEST_TIMEOUT_MS,
			startedAt + REQUEST_TIMEOUT_MS
		),
	};
}

function assertDeadline(options: HttpRequestOptions): void {
	if (
		options.deadline === undefined ||
		!Number.isFinite(options.deadline) ||
		Date.now() >= options.deadline
	) {
		throw new HttpError('TIMEOUT');
	}
	options.assertCurrent?.();
}

export class UnifiedProvider implements APIProvider {
	buildHeaders(
		apiKey: string,
		providerName: string = PROVIDER_NAMES.OPENAI
	): Record<string, string> {
		return getProviderSpec(providerName).buildHeaders(apiKey);
	}

	async callAPI(
		systemRole: string,
		userPrompt: string,
		provider: ProviderConfig,
		selectedModel: string,
		temperature?: number,
		onTokenRefresh?: OnTokenRefreshCallback,
		requestOptions?: HttpRequestOptions
	): Promise<GeneratedTags> {
		const spec = getProviderSpec(provider.name);
		const deadlineOptions = requestOptionsWithDeadline(requestOptions);
		assertDeadline(deadlineOptions);
		const apiKey =
			provider.auth?.type === 'apiKey' ? provider.auth.apiKey : (provider.apiKey ?? '');
		const headers = spec.buildHeaders(apiKey, provider);
		const body = spec.buildRequestBody(
			systemRole,
			userPrompt,
			selectedModel,
			provider.temperature ?? temperature
		);
		const url = spec.buildUrl(provider.baseUrl, selectedModel, apiKey);

		if (spec.requiresStreaming && spec.parseStreamEvent && spec.parseStreamResponse) {
			try {
				const text = await sendStreamingRequest(
					url,
					headers,
					body,
					spec.parseStreamEvent,
					deadlineOptions
				);
				assertDeadline(deadlineOptions);
				return spec.parseStreamResponse(text);
			} catch (error) {
				if (
					error instanceof HttpError &&
					error.status === 401 &&
					provider.name === PROVIDER_NAMES.CODEX
				) {
					assertDeadline(deadlineOptions);
					return this.refreshCodexTokensAndRetry(
						provider,
						systemRole,
						userPrompt,
						selectedModel,
						temperature,
						onTokenRefresh,
						deadlineOptions
					);
				}
				throw error;
			}
		}

		const response = await sendRequest(url, headers, body, deadlineOptions);
		assertDeadline(deadlineOptions);
		return spec.parseResponse(response);
	}

	private async refreshCodexTokensAndRetry(
		provider: ProviderConfig,
		systemRole: string,
		userPrompt: string,
		selectedModel: string,
		temperature: number | undefined,
		onTokenRefresh: OnTokenRefreshCallback | undefined,
		requestOptions: HttpRequestOptions
	): Promise<GeneratedTags> {
		const oauth = extractOAuthTokens(provider);
		if (!oauth) throw new Error('Codex authentication is unavailable');

		let newTokens: Awaited<ReturnType<CodexOAuth['refreshTokens']>>;
		try {
			newTokens = await new CodexOAuth().refreshTokens(oauth);
		} catch {
			throw new Error('Codex authentication refresh failed');
		}
		assertDeadline(requestOptions);
		const updatedProvider: ProviderConfig = {
			...provider,
			auth: { type: 'oauth', oauth: newTokens },
			oauth: newTokens,
		};
		if (onTokenRefresh) await onTokenRefresh(newTokens);
		assertDeadline(requestOptions);

		const spec = getProviderSpec(provider.name);
		const headers = spec.buildHeaders('', updatedProvider);
		const body = spec.buildRequestBody(
			systemRole,
			userPrompt,
			selectedModel,
			provider.temperature ?? temperature
		);
		const url = spec.buildUrl(provider.baseUrl, selectedModel, '');
		if (!spec.parseStreamEvent || !spec.parseStreamResponse)
			throw new Error('Invalid streaming provider');
		const text = await sendStreamingRequest(
			url,
			headers,
			body,
			spec.parseStreamEvent,
			requestOptions
		);
		assertDeadline(requestOptions);
		return spec.parseStreamResponse(text);
	}

	processApiResponse(
		responseData: unknown,
		providerName: string = PROVIDER_NAMES.OPENAI
	): GeneratedTags {
		return getProviderSpec(providerName).parseResponse(responseData);
	}
}
