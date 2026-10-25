import { CODEX_OAUTH } from '../../domain/auth/oauth-constants';
import { createTokensFromResponse } from '../../domain/auth/token-manager';
import type { OAuthTokens } from '../../types/auth';
import { HttpError, sendRequest } from '../request';
import type { HttpRequestOptions } from '../request';
import { authenticateByDeviceCode, OAuthError } from './device-auth';

export { OAuthError } from './device-auth';
export type { OAuthErrorCode } from './device-auth';

function mapRequestError(error: unknown, options?: HttpRequestOptions): OAuthError {
	if (error instanceof OAuthError) return error;
	if (options?.signal?.aborted || (error instanceof HttpError && error.code === 'CANCELLED')) {
		return new OAuthError('cancelled');
	}
	if (
		(options?.deadline !== undefined && Date.now() >= options.deadline) ||
		(error instanceof HttpError && error.code === 'TIMEOUT')
	) {
		return new OAuthError('timeout');
	}
	if (
		error instanceof HttpError &&
		(error.code === 'INVALID_JSON' || error.code === 'PROTOCOL_ERROR')
	) {
		return new OAuthError('invalid');
	}
	return new OAuthError('failed');
}

export class CodexOAuth {
	private activeFlow: AbortController | null = null;

	async startAuthFlow(
		onDeviceCode: (details: { userCode: string; verificationUri: string }) => void
	): Promise<OAuthTokens> {
		this.cancelFlow();
		const controller = new AbortController();
		this.activeFlow = controller;
		const deadline = Date.now() + CODEX_OAUTH.DEVICE_FLOW_TIMEOUT_MS;
		const assertCurrent = (): void => {
			if (controller.signal.aborted || this.activeFlow !== controller) {
				throw new OAuthError('cancelled');
			}
			if (Date.now() >= deadline) throw new OAuthError('timeout');
		};

		try {
			const tokenResponse = await authenticateByDeviceCode({
				deadline,
				signal: controller.signal,
				assertCurrent,
				onDeviceCode,
			});
			assertCurrent();
			try {
				return createTokensFromResponse(tokenResponse);
			} catch {
				throw new OAuthError('invalid');
			}
		} catch (error) {
			throw mapRequestError(error, { deadline, signal: controller.signal });
		} finally {
			if (this.activeFlow === controller) this.activeFlow = null;
		}
	}

	async refreshTokens(refreshToken: string, options?: HttpRequestOptions): Promise<OAuthTokens> {
		if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
			throw new OAuthError('invalid');
		}
		try {
			const response = await sendRequest(
				CODEX_OAUTH.TOKEN_ENDPOINT,
				{ 'Content-Type': 'application/json' },
				{
					grant_type: 'refresh_token',
					client_id: CODEX_OAUTH.CLIENT_ID,
					refresh_token: refreshToken,
				},
				{ ...options, maxAttempts: 1 }
			);
			try {
				// A successful refresh need not rotate the existing refresh token.
				const tokenResponse =
					typeof response === 'object' &&
					response !== null &&
					!Array.isArray(response) &&
					!Object.prototype.hasOwnProperty.call(response, 'refresh_token')
						? { ...response, refresh_token: refreshToken }
						: response;
				return createTokensFromResponse(tokenResponse);
			} catch {
				throw new OAuthError('invalid');
			}
		} catch (error) {
			throw mapRequestError(error, options);
		}
	}

	cancelFlow(): void {
		this.activeFlow?.abort();
		this.activeFlow = null;
	}
}
