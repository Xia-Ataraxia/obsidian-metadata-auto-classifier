/**
 * OAuth token data structure for authentication
 */
export interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId: string;
}

/**
 * Token exchange response from OAuth provider
 */
export interface TokenResponse {
	access_token: string;
	refresh_token: string;
	id_token?: string;
	expires_in?: number;
	token_type?: string;
}
