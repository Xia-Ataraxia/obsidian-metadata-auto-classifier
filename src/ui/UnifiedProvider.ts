
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
const inFlightCodexRefreshTokens = new Set<string>();

type ProviderAuthMode = 'apiKey' | 'oauth';

const AUTH_MODE_ERROR = 'Provider authentication mode is unsupported';
const AUTH_UNAVAILABLE_ERROR = 'Provider authentication is unavailable';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCredentialString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function hasOAuthCredential(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasCredentialString(value.accessToken) &&
		hasCredentialString(value.refreshToken) &&
		hasCredentialString(value.accountId) &&
		typeof value.expiresAt === 'number' &&
		Number.isFinite(value.expiresAt)
	);
}

function resolveApiKey(provider: ProviderConfig): string {
	const expectedAuth: ProviderAuthMode =
		provider.name === PROVIDER_NAMES.CODEX ? 'oauth' : 'apiKey';
	const optionalKey =
		provider.name === PROVIDER_NAMES.OLLAMA || provider.name === PROVIDER_NAMES.LMSTUDIO;
	const configuredAuthType: unknown = provider.authType;

	if (provider.auth !== undefined) {
		const auth: unknown = provider.auth;
		if (!isRecord(auth) || auth.type !== expectedAuth) {
			throw new Error(AUTH_MODE_ERROR);
		}
		if (expectedAuth === 'oauth') {
			if (!hasOAuthCredential(auth.oauth)) throw new Error(AUTH_UNAVAILABLE_ERROR);
			return '';
		}
		if (typeof auth.apiKey !== 'string') throw new Error(AUTH_UNAVAILABLE_ERROR);
		if (optionalKey) return auth.apiKey.trim().length > 0 ? auth.apiKey : '';
		if (!hasCredentialString(auth.apiKey)) throw new Error(AUTH_UNAVAILABLE_ERROR);
		return auth.apiKey;
	}

	if (configuredAuthType !== undefined && configuredAuthType !== expectedAuth) {
		throw new Error(AUTH_MODE_ERROR);
	}
	if (expectedAuth === 'oauth') {
		if (!hasOAuthCredential(provider.oauth)) throw new Error(AUTH_UNAVAILABLE_ERROR);
		return '';
	}
	if (provider.apiKey === undefined && optionalKey) return '';
	if (typeof provider.apiKey !== 'string') throw new Error(AUTH_UNAVAILABLE_ERROR);
	if (optionalKey) return provider.apiKey.trim().length > 0 ? provider.apiKey : '';
	if (!hasCredentialString(provider.apiKey)) throw new Error(AUTH_UNAVAILABLE_ERROR);
	return provider.apiKey;
}

function extractOAuthTokens(provider: ProviderConfig) {
	if (provider.auth !== undefined) {
		const auth: unknown = provider.auth;
		return provider.name === PROVIDER_NAMES.CODEX &&
			isRecord(auth) &&
			auth.type === 'oauth' &&
			hasOAuthCredential(auth.oauth)
			? (auth.oauth as ProviderConfig['oauth'])
			: undefined;
	}
	if (provider.name !== PROVIDER_NAMES.CODEX) return undefined;
	if (provider.authType !== undefined && provider.authType !== 'oauth') return undefined;
	return hasOAuthCredential(provider.oauth) ? provider.oauth : undefined;
}

function getProviderSpec(providerName: string): ProviderSpec {
	const spec = Object.prototype.hasOwnProperty.call(chatProviderSpecs, providerName)
		? chatProviderSpecs[providerName]
		: Object.prototype.hasOwnProperty.call(nativeProviderSpecs, providerName)
			? nativeProviderSpecs[providerName]
			: // Any non-preset name is a user-named OpenAI-compatible endpoint.
				chatProviderSpecs[PROVIDER_NAMES.CUSTOM];
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
	if (options.signal?.aborted) throw new HttpError('CANCELLED');
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
		const apiKey = resolveApiKey(provider);
		const deadlineOptions = requestOptionsWithDeadline(requestOptions);
		assertDeadline(deadlineOptions);
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
		if (inFlightCodexRefreshTokens.has(oauth.refreshToken))
			throw new Error('Codex token refresh is already in progress');
		if (!onTokenRefresh) throw new Error('Codex token persistence is unavailable');

		inFlightCodexRefreshTokens.add(oauth.refreshToken);
		try {
			let newTokens: Awaited<ReturnType<CodexOAuth['refreshTokens']>>;
			try {
				newTokens = await new CodexOAuth().refreshTokens(oauth.refreshToken, requestOptions);
			} catch (error) {
				assertDeadline(requestOptions);
				if (error instanceof HttpError) throw error;
				throw new Error('Codex authentication refresh failed');
			}
			assertDeadline(requestOptions);
			if (newTokens.accountId !== oauth.accountId)
				throw new Error('Codex account changed during refresh');
			const updatedProvider: ProviderConfig = {
				...provider,
				auth: { type: 'oauth', oauth: newTokens },
				oauth: newTokens,
			};
			await onTokenRefresh(newTokens);
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
		} finally {
			inFlightCodexRefreshTokens.delete(oauth.refreshToken);
		}
	}

	processApiResponse(
		responseData: unknown,
		providerName: string = PROVIDER_NAMES.OPENAI
	): GeneratedTags {
		return getProviderSpec(providerName).parseResponse(responseData);
	}
}
