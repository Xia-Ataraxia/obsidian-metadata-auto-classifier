import { CODEX_OAUTH } from '../../domain/auth/oauth-constants';
import { HttpError, sendHttpRequest } from '../request';
import type { HttpRequestOptions } from '../request';
import { waitBeforeDeadline } from '../request-control';

export type OAuthErrorCode = 'cancelled' | 'timeout' | 'disabled' | 'invalid' | 'failed';

export class OAuthError extends Error {
	constructor(readonly code: OAuthErrorCode) {
		super(`OAuth authentication ${code}`);
		this.name = 'OAuthError';
	}
}

export interface DeviceCodeDetails {
	userCode: string;
	verificationUri: string;
}

interface DeviceAuthOptions {
	deadline: number;
	signal: AbortSignal;
	assertCurrent: () => void;
	onDeviceCode: (details: DeviceCodeDetails) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new OAuthError('invalid');
	}
}

function requireString(value: unknown): string {
	if (typeof value !== 'string' || value.trim().length === 0) throw new OAuthError('invalid');
	return value;
}

function assertActive(options: DeviceAuthOptions): void {
	if (options.signal.aborted) throw new OAuthError('cancelled');
	if (Date.now() >= options.deadline) throw new OAuthError('timeout');
	options.assertCurrent();
}

function requestOptions(options: DeviceAuthOptions): HttpRequestOptions {
	return {
		deadline: options.deadline,
		assertCurrent: () => assertActive(options),
		signal: options.signal,
		maxAttempts: 1,
	};
}

function mapFailure(error: unknown, options: DeviceAuthOptions): OAuthError {
	if (error instanceof OAuthError) return error;
	if (options.signal.aborted) return new OAuthError('cancelled');
	if (Date.now() >= options.deadline) return new OAuthError('timeout');
	if (error instanceof HttpError) {
		if (error.code === 'CANCELLED') return new OAuthError('cancelled');
		if (error.code === 'TIMEOUT') return new OAuthError('timeout');
		if (error.code === 'INVALID_JSON' || error.code === 'PROTOCOL_ERROR') {
			return new OAuthError('invalid');
		}
	}
	return new OAuthError('failed');
}

function parseInterval(value: unknown): number {
	if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
		throw new OAuthError('invalid');
	}
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) throw new OAuthError('invalid');
	const milliseconds = seconds * 1000;
	if (!Number.isFinite(milliseconds) || milliseconds < 1) throw new OAuthError('invalid');
	return milliseconds;
}

async function waitForPoll(delayMs: number, options: DeviceAuthOptions): Promise<void> {
	assertActive(options);
	await waitBeforeDeadline(delayMs, options.deadline, options.signal);
	assertActive(options);
}

export async function authenticateByDeviceCode(options: DeviceAuthOptions): Promise<unknown> {
	const jsonHeaders = { 'Content-Type': 'application/json' };
	const requestOptionsValue = requestOptions(options);
	try {
		assertActive(options);
		let userCodeResponse;
		try {
			userCodeResponse = await sendHttpRequest(
				CODEX_OAUTH.DEVICE_USER_CODE_ENDPOINT,
				jsonHeaders,
				{ client_id: CODEX_OAUTH.CLIENT_ID },
				requestOptionsValue
			);
		} catch (error) {
			if (error instanceof HttpError && error.status === 404) throw new OAuthError('disabled');
			throw error;
		}

		const userCodePayload = parseJson(userCodeResponse.text);
		if (!isRecord(userCodePayload)) throw new OAuthError('invalid');
		const deviceAuthId = requireString(userCodePayload['device_auth_id']);
		const userCode = requireString(userCodePayload['user_code']);
		const intervalMs = parseInterval(userCodePayload['interval']);
		assertActive(options);
		options.onDeviceCode({ userCode, verificationUri: CODEX_OAUTH.DEVICE_VERIFICATION_URI });

		while (true) {
			assertActive(options);
			let authorizationPayload: unknown;
			try {
				const pollResponse = await sendHttpRequest(
					CODEX_OAUTH.DEVICE_TOKEN_ENDPOINT,
					jsonHeaders,
					{ device_auth_id: deviceAuthId, user_code: userCode },
					requestOptionsValue
				);
				authorizationPayload = parseJson(pollResponse.text);
			} catch (error) {
				if (!(error instanceof HttpError) || (error.status !== 403 && error.status !== 404)) {
					throw error;
				}
				await waitForPoll(intervalMs, options);
				continue;
			}

			if (!isRecord(authorizationPayload)) throw new OAuthError('invalid');
			const authorizationCode = requireString(authorizationPayload['authorization_code']);
			const codeVerifier = requireString(authorizationPayload['code_verifier']);
			assertActive(options);
			const form = new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: CODEX_OAUTH.CLIENT_ID,
				code: authorizationCode,
				redirect_uri: CODEX_OAUTH.DEVICE_CALLBACK_URI,
				code_verifier: codeVerifier,
			});
			const tokenResponse = await sendHttpRequest(
				CODEX_OAUTH.TOKEN_ENDPOINT,
				{ 'Content-Type': 'application/x-www-form-urlencoded' },
				form.toString(),
				requestOptionsValue
			);
			assertActive(options);
			return parseJson(tokenResponse.text);
		}
	} catch (error) {
		throw mapFailure(error, options);
	}
}
