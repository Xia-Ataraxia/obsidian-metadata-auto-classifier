import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { CODEX_OAUTH } from '../../../src/domain/auth/oauth-constants';
import { CodexOAuth, OAuthError } from '../../../src/ui/auth/oauth';
import type { OAuthTokens } from '../../../src/types/auth';
import { requestUrlPromise } from '../../helpers/request-url';

const sharedRequestMocks = vi.hoisted(() => ({ sendRequest: vi.fn() }));
const tokenManagerMocks = vi.hoisted(() => ({
	createTokensFromResponse: vi.fn(),
}));

vi.mock('../../../src/ui/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../src/ui/request')>();
	return { ...actual, sendRequest: sharedRequestMocks.sendRequest };
});

vi.mock('../../../src/domain/auth/token-manager', () => tokenManagerMocks);
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, requestUrl: vi.fn() };
});

const mockRequestUrl = vi.mocked(requestUrl);
const tokenResponse = {
	access_token: 'access-token-secret',
	refresh_token: 'refresh-token-secret',
};
const tokens: OAuthTokens = {
	accessToken: 'access-token-secret',
	refreshToken: 'refresh-token-secret',
	expiresAt: 4_000_000_000,
	accountId: 'account-id',
};

function response(status: number, body: unknown): RequestUrlResponse {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	if (text === undefined) throw new Error('Synthetic response body is not serializable');
	return {
		status,
		text,
		arrayBuffer: new TextEncoder().encode(text).buffer,
		json: body,
		headers: {},
	};
}

function requestParam(index: number): RequestUrlParam {
	const param = mockRequestUrl.mock.calls[index]?.[0];
	if (typeof param !== 'object' || param === null) {
		throw new Error(`Missing request ${index}`);
	}
	return param;
}

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 10; index++) await Promise.resolve();
}

function queueDeviceFlow(
	pollResponses: RequestUrlResponse[] = [
		response(200, {
			authorization_code: 'authorization-code',
			code_verifier: 'server-code-verifier',
		}),
	]
): void {
	mockRequestUrl.mockResolvedValueOnce(
		response(200, {
			device_auth_id: 'device-auth-id',
			user_code: 'ABCD-EFGH',
			interval: '1',
		})
	);
	for (const pollResponse of pollResponses) mockRequestUrl.mockResolvedValueOnce(pollResponse);
	mockRequestUrl.mockResolvedValueOnce(response(200, tokenResponse));
}

describe('CodexOAuth device authorization', () => {
	let oauth: CodexOAuth;

	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mockRequestUrl.mockReset();
		sharedRequestMocks.sendRequest.mockReset();
		tokenManagerMocks.createTokensFromResponse.mockImplementation((value: unknown) => {
			if (
				typeof value !== 'object' ||
				value === null ||
				!('access_token' in value) ||
				!('refresh_token' in value)
			) {
				throw new Error('Invalid token response');
			}
			return { ...tokens };
		});
		oauth = new CodexOAuth();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('uses the documented JSON requests and exchanges once with the hosted callback URI', async () => {
		queueDeviceFlow();
		const onDeviceCode = vi.fn();

		await expect(oauth.startAuthFlow(onDeviceCode)).resolves.toEqual(tokens);

		expect(onDeviceCode).toHaveBeenCalledOnce();
		expect(onDeviceCode).toHaveBeenCalledWith({
			userCode: 'ABCD-EFGH',
			verificationUri: CODEX_OAUTH.DEVICE_VERIFICATION_URI,
		});
		expect(requestParam(0)).toMatchObject({
			url: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ client_id: CODEX_OAUTH.CLIENT_ID }),
		});
		expect(requestParam(1)).toMatchObject({
			url: 'https://auth.openai.com/api/accounts/deviceauth/token',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ device_auth_id: 'device-auth-id', user_code: 'ABCD-EFGH' }),
		});
		expect(requestParam(2)).toMatchObject({
			url: 'https://auth.openai.com/oauth/token',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: CODEX_OAUTH.CLIENT_ID,
				code: 'authorization-code',
				redirect_uri: 'https://auth.openai.com/deviceauth/callback',
				code_verifier: 'server-code-verifier',
			}).toString(),
		});
		expect(mockRequestUrl).toHaveBeenCalledTimes(3);
		expect(tokenManagerMocks.createTokensFromResponse).toHaveBeenCalledWith(tokenResponse);
	});

	it('treats an initial user-code 404 as disabled', async () => {
		mockRequestUrl.mockResolvedValueOnce(response(404, { message: 'private server text' }));

		await expect(oauth.startAuthFlow(vi.fn())).rejects.toMatchObject({
			code: 'disabled',
			message: 'OAuth authentication disabled',
		});
		expect(mockRequestUrl).toHaveBeenCalledOnce();
	});

	it('does not retry the one-time final exchange after a 429 response', async () => {
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				device_auth_id: 'device-auth-id',
				user_code: 'ABCD-EFGH',
				interval: '1',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				authorization_code: 'authorization-code',
				code_verifier: 'server-verifier',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(response(429, { private_message: 'secret' }));

		await expect(oauth.startAuthFlow(vi.fn())).rejects.toMatchObject({ code: 'failed' });
		expect(mockRequestUrl).toHaveBeenCalledTimes(3);
	});

	it('treats polling 403 and 404 as pending and waits the positive server interval', async () => {
		vi.useFakeTimers();
		queueDeviceFlow([
			response(403, {}),
			response(404, {}),
			response(200, { authorization_code: 'authorization-code', code_verifier: 'server-verifier' }),
		]);
		const flow = oauth.startAuthFlow(vi.fn());
		await flushPromises();
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(999);
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		await flushPromises();
		expect(mockRequestUrl).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(1_000);
		await expect(flow).resolves.toEqual(tokens);
		expect(mockRequestUrl).toHaveBeenCalledTimes(5);
	});

	it.each([
		{ label: 'missing device identifier', body: { user_code: 'ABCD-EFGH', interval: '1' } },
		{ label: 'missing one-time code', body: { device_auth_id: 'device-auth-id', interval: '1' } },
		{
			label: 'zero polling interval',
			body: { device_auth_id: 'device-auth-id', user_code: 'ABCD-EFGH', interval: '0' },
		},
	])('rejects malformed user-code response: $label', async ({ body }) => {
		mockRequestUrl.mockResolvedValueOnce(response(200, body));

		await expect(oauth.startAuthFlow(vi.fn())).rejects.toMatchObject({ code: 'invalid' });
		expect(mockRequestUrl).toHaveBeenCalledOnce();
	});

	it('rejects invalid JSON without including the response body in its error', async () => {
		mockRequestUrl.mockResolvedValueOnce(response(200, 'invalid-json-secret'));
		const error = await oauth.startAuthFlow(vi.fn()).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(OAuthError);
		expect(error).toMatchObject({ code: 'invalid' });
		expect((error as Error).message).not.toContain('invalid-json-secret');
	});

	it('rejects malformed poll and token responses without exposing response data', async () => {
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				device_auth_id: 'device-auth-id',
				user_code: 'ABCD-EFGH',
				interval: '1',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				authorization_code: 'secret-authorization-code',
			})
		);
		await expect(oauth.startAuthFlow(vi.fn())).rejects.toMatchObject({ code: 'invalid' });
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);

		mockRequestUrl.mockReset();
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				device_auth_id: 'device-auth-id',
				user_code: 'ABCD-EFGH',
				interval: '1',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				authorization_code: 'authorization-code',
				code_verifier: 'secret-verifier',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(response(200, { private_token: 'secret-token-value' }));
		tokenManagerMocks.createTokensFromResponse.mockImplementationOnce(() => {
			throw new Error('secret-token-value');
		});
		const error = await oauth.startAuthFlow(vi.fn()).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(OAuthError);
		expect(error).toMatchObject({ code: 'invalid' });
		expect((error as Error).message).not.toContain('secret-token-value');
	});

	it('cancels an in-flight request promptly', async () => {
		mockRequestUrl.mockImplementationOnce(() =>
			requestUrlPromise(() => undefined)
		);
		const flow = oauth.startAuthFlow(vi.fn());
		await flushPromises();
		oauth.cancelFlow();

		await expect(flow).rejects.toMatchObject({ code: 'cancelled' });
		expect(mockRequestUrl).toHaveBeenCalledOnce();
	});

	it('cancels promptly while waiting between pending polls', async () => {
		vi.useFakeTimers();
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				device_auth_id: 'device-auth-id',
				user_code: 'ABCD-EFGH',
				interval: '10',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(response(403, {}));
		const flow = oauth.startAuthFlow(vi.fn());
		await flushPromises();
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		oauth.cancelFlow();

		await expect(flow).rejects.toMatchObject({ code: 'cancelled' });
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('rejects an expired flow instead of polling again after backgrounded timers resume', async () => {
		vi.useFakeTimers();
		mockRequestUrl.mockResolvedValueOnce(
			response(200, {
				device_auth_id: 'device-auth-id',
				user_code: 'ABCD-EFGH',
				interval: '1000',
			})
		);
		mockRequestUrl.mockResolvedValueOnce(response(404, {}));
		const flow = oauth.startAuthFlow(vi.fn());
		const rejection = expect(flow).rejects.toMatchObject({ code: 'timeout' });
		await flushPromises();
		await vi.advanceTimersByTimeAsync(CODEX_OAUTH.DEVICE_FLOW_TIMEOUT_MS);

		await rejection;
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('invalidates a prior flow and ignores its late response', async () => {
		let resolveStaleRequest!: (value: RequestUrlResponse) => void;
		mockRequestUrl.mockImplementationOnce(
			() =>
				requestUrlPromise(
					(resolve) => {
						resolveStaleRequest = resolve;
					}
				)
		);
		const staleCodeCallback = vi.fn();
		const staleFlow = oauth.startAuthFlow(staleCodeCallback);
		await flushPromises();

		queueDeviceFlow();
		const currentFlow = oauth.startAuthFlow(vi.fn());
		await expect(staleFlow).rejects.toMatchObject({ code: 'cancelled' });
		await expect(currentFlow).resolves.toEqual(tokens);
		resolveStaleRequest(
			response(200, {
				device_auth_id: 'stale-device-id',
				user_code: 'STALE-CODE',
				interval: '1',
			})
		);
		await flushPromises();

		expect(staleCodeCallback).not.toHaveBeenCalled();
		expect(mockRequestUrl).toHaveBeenCalledTimes(4);
	});

	it('retains the refresh token when a successful response does not rotate it', async () => {
		sharedRequestMocks.sendRequest.mockResolvedValue({ access_token: 'new-access' });
		await oauth.refreshTokens('retained-refresh');
		expect(tokenManagerMocks.createTokensFromResponse).toHaveBeenCalledWith({
			access_token: 'new-access',
			refresh_token: 'retained-refresh',
		});
		expect(sharedRequestMocks.sendRequest).toHaveBeenCalledOnce();
	});

	it('does not replace an explicitly invalid rotated token with the previous token', async () => {
		sharedRequestMocks.sendRequest.mockResolvedValue({
			access_token: 'new-access',
			refresh_token: null,
		});
		tokenManagerMocks.createTokensFromResponse.mockImplementationOnce(() => {
			throw new Error('Invalid token response');
		});
		await expect(oauth.refreshTokens('retained-refresh')).rejects.toMatchObject({
			code: 'invalid',
		});
		expect(tokenManagerMocks.createTokensFromResponse).toHaveBeenCalledWith({
			access_token: 'new-access',
			refresh_token: null,
		});
	});

	it('refreshes with JSON once and forwards the caller deadline and current guard', async () => {
		sharedRequestMocks.sendRequest.mockResolvedValue(tokenResponse);
		const deadline = Date.now() + 30_000;
		const assertCurrent = vi.fn();
		const controller = new AbortController();

		await expect(
			oauth.refreshTokens('refresh-token', {
				deadline,
				assertCurrent,
				signal: controller.signal,
				maxAttempts: 3,
			})
		).resolves.toEqual(tokens);

		expect(sharedRequestMocks.sendRequest).toHaveBeenCalledOnce();
		expect(sharedRequestMocks.sendRequest).toHaveBeenCalledWith(
			CODEX_OAUTH.TOKEN_ENDPOINT,
			{ 'Content-Type': 'application/json' },
			{
				grant_type: 'refresh_token',
				client_id: CODEX_OAUTH.CLIENT_ID,
				refresh_token: 'refresh-token',
			},
			{ deadline, assertCurrent, signal: controller.signal, maxAttempts: 1 }
		);
	});
});
