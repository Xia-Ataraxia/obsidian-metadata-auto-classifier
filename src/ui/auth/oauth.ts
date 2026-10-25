import { Platform, requestUrl } from 'obsidian';
import { CODEX_OAUTH } from '../../domain/auth/oauth-constants';
import { OAuthCallbackServer } from './oauth-server';
import { generatePKCEChallenge, generateState } from '../../domain/auth/pkce';
import { createTokensFromResponse, isTokenExpired } from '../../domain/auth/token-manager';
import type { OAuthTokens, TokenResponse } from '../../types/auth';

/**
 * OAuth handler for OpenAI Codex/ChatGPT Pro authentication
 */
export class CodexOAuth {
	private callbackServer: OAuthCallbackServer | null = null;

	/**
	 * Check if the current platform supports OAuth (Desktop only)
	 */
	static isSupported(): boolean {
		return Platform.isDesktop;
	}

	/**
	 * Start the OAuth authorization flow
	 * Opens browser for user login and waits for callback
	 */
	async startAuthFlow(): Promise<OAuthTokens> {
		if (!CodexOAuth.isSupported()) {
			throw new Error('OAuth is only supported on desktop platforms');
		}

		// Generate PKCE challenge and state
		const pkce = await generatePKCEChallenge();
		const state = generateState();

		// Build authorization URL
		const authUrl = this.buildAuthorizationUrl(pkce.codeChallenge, state);

		// Start callback server
		this.callbackServer = new OAuthCallbackServer();

		try {
			// Open browser for authorization
			window.open(authUrl, '_blank');

			// Wait for callback with authorization code
			const callbackResponse = await this.callbackServer.waitForCallback(state);

			// Exchange code for tokens
			const tokens = await this.exchangeCodeForTokens(callbackResponse.code, pkce.codeVerifier);

			return tokens;
		} finally {
			this.callbackServer?.stop();
			this.callbackServer = null;
		}
	}

	/**
	 * Build the OAuth authorization URL
	 */
	private buildAuthorizationUrl(codeChallenge: string, state: string): string {
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: CODEX_OAUTH.CLIENT_ID,
			redirect_uri: CODEX_OAUTH.REDIRECT_URI,
			scope: CODEX_OAUTH.SCOPES.join(' '),
			state,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			// Required for Codex OAuth
			id_token_add_organizations: 'true',
			codex_cli_simplified_flow: 'true',
			originator: 'metadata-auto-classifier',
		});

		return `${CODEX_OAUTH.AUTHORIZATION_ENDPOINT}?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for access and refresh tokens
	 */
	private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: CODEX_OAUTH.CLIENT_ID,
			code,
			redirect_uri: CODEX_OAUTH.REDIRECT_URI,
			code_verifier: codeVerifier,
		});

		const response = await requestUrl({
			url: CODEX_OAUTH.TOKEN_ENDPOINT,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
		});

		if (response.status !== 200) {
			const json = response.json as { error_description?: string; error?: string };
			const error = json.error_description || json.error || 'Token exchange failed';
			throw new Error(`Token exchange failed: ${error}`);
		}

		const tokenResponse = response.json as TokenResponse;
		return createTokensFromResponse(tokenResponse);
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: CODEX_OAUTH.CLIENT_ID,
			refresh_token: tokens.refreshToken,
		});

		const response = await requestUrl({
			url: CODEX_OAUTH.TOKEN_ENDPOINT,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
		});

		if (response.status !== 200) {
			const json = response.json as { error_description?: string; error?: string };
			const error = json.error_description || json.error || 'Token refresh failed';
			throw new Error(`Token refresh failed: ${error}`);
		}

		const tokenResponse = response.json as TokenResponse;

		// Preserve the original refresh token if a new one isn't provided
		const newTokens = createTokensFromResponse(tokenResponse);
		if (!newTokens.refreshToken && tokens.refreshToken) {
			newTokens.refreshToken = tokens.refreshToken;
		}

		// Preserve the original account ID if extraction fails
		if (!newTokens.accountId && tokens.accountId) {
			newTokens.accountId = tokens.accountId;
		}

		return newTokens;
	}

	/**
	 * Refresh tokens if they are expired or about to expire
	 * @returns Updated tokens if refreshed, or original tokens if still valid
	 */
	async refreshTokensIfNeeded(tokens: OAuthTokens): Promise<OAuthTokens> {
		if (!isTokenExpired(tokens)) {
			return tokens;
		}

		return this.refreshTokens(tokens);
	}

	/**
	 * Cancel any ongoing OAuth flow
	 */
	cancelFlow(): void {
		this.callbackServer?.stop();
		this.callbackServer = null;
	}
}
