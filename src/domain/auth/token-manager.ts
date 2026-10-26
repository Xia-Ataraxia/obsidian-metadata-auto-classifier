import { CODEX_OAUTH } from './oauth-constants';
import type { OAuthTokens } from '../../types/auth';

const AUTH_CLAIMS = 'https://api.openai.com/auth';
const INVALID_JWT = 'Invalid JWT';
const INVALID_ACCOUNT_ID = 'Invalid token account ID';
const INVALID_RESPONSE = 'Invalid token response';
const INVALID_EXPIRY = 'Invalid token expiry';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function decodeBase64Url(segment: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) {
		throw new Error(INVALID_JWT);
	}

	try {
		const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
		const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
		const canonical = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
		if (canonical !== segment) throw new Error(INVALID_JWT);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		throw new Error(INVALID_JWT);
	}
}

function decodeJwtObject(segment: string): Record<string, unknown> {
	try {
		const json = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(segment));
		const value: unknown = JSON.parse(json);
		if (!isRecord(value)) throw new Error(INVALID_JWT);
		return value;
	} catch {
		throw new Error(INVALID_JWT);
	}
}

function accountIdFromClaims(claims: Record<string, unknown>): string {
	const authClaims = claims[AUTH_CLAIMS];
	if (!isRecord(authClaims)) throw new Error(INVALID_ACCOUNT_ID);

	const accountId = authClaims.chatgpt_account_id;
	if (typeof accountId !== 'string' || !/^[\u0021-\u007e]+$/.test(accountId)) {
		throw new Error(INVALID_ACCOUNT_ID);
	}
	return accountId;
}

/**
 * Parse JWT claims without verifying its signature; claims are routing and expiry hints only.
 */
export function parseJwtClaims(token: string): Record<string, unknown> {
	if (typeof token !== 'string') throw new Error(INVALID_JWT);
	const parts = token.split('.');
	if (parts.length !== 3) throw new Error(INVALID_JWT);
	decodeJwtObject(parts[0]!);
	decodeBase64Url(parts[2]!);
	return decodeJwtObject(parts[1]!);
}

/**
 * Extract the documented workspace account ID from an access token.
 */
export function extractAccountId(accessToken: string): string {
	return accountIdFromClaims(parseJwtClaims(accessToken));
}

/**
 * Check if tokens are expired or about to expire
 * @param tokens The OAuth tokens to check
 * @param bufferSeconds How many seconds before expiry to consider "expired" (default: 5 minutes)
 */
export function isTokenExpired(tokens: OAuthTokens, bufferSeconds?: number): boolean {
	const buffer = bufferSeconds ?? CODEX_OAUTH.TOKEN_REFRESH_BUFFER_SECONDS;
	const expiresAt = tokens?.expiresAt;
	if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return true;
	if (typeof buffer !== 'number' || !Number.isFinite(buffer) || buffer < 0) return true;
	const expiresWithBuffer = expiresAt - buffer;
	return Date.now() / 1000 >= expiresWithBuffer;
}

/**
 * Validate an untrusted token response and create the stable token model.
 */
export function createTokensFromResponse(response: unknown): OAuthTokens {
	if (!isRecord(response)) throw new Error(INVALID_RESPONSE);
	if (!hasOwn(response, 'access_token') || !hasOwn(response, 'refresh_token')) {
		throw new Error(INVALID_RESPONSE);
	}

	const accessToken = response.access_token;
	const refreshToken = response.refresh_token;
	if (
		typeof accessToken !== 'string' ||
		accessToken.trim().length === 0 ||
		typeof refreshToken !== 'string' ||
		refreshToken.trim().length === 0
	) {
		throw new Error(INVALID_RESPONSE);
	}

	let idToken: string | undefined;
	if (hasOwn(response, 'id_token')) {
		const value = response.id_token;
		if (typeof value !== 'string' || value.trim().length === 0) throw new Error(INVALID_RESPONSE);
		idToken = value;
	}

	let expiresIn: number | undefined;
	if (hasOwn(response, 'expires_in')) {
		const value = response.expires_in;
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
			throw new Error(INVALID_RESPONSE);
		}
		expiresIn = value;
	}

	if (hasOwn(response, 'token_type')) {
		const tokenType = response.token_type;
		if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
			throw new Error(INVALID_RESPONSE);
		}
	}

	const accessClaims = parseJwtClaims(accessToken);
	const accountId = accountIdFromClaims(accessClaims);
	if (idToken !== undefined && accountIdFromClaims(parseJwtClaims(idToken)) !== accountId) {
		throw new Error(INVALID_ACCOUNT_ID);
	}

	const now = Date.now() / 1000;
	const accessExpiry = accessClaims.exp;
	if (
		typeof accessExpiry !== 'number' ||
		!Number.isFinite(accessExpiry) ||
		!Number.isInteger(accessExpiry) ||
		accessExpiry <= now
	) {
		throw new Error(INVALID_EXPIRY);
	}
	const expiresAt =
		expiresIn === undefined ? accessExpiry : Math.min(accessExpiry, Math.floor(now) + expiresIn);

	return {
		accessToken,
		refreshToken,
		expiresAt,
		accountId,
	};
}

/**
 * Calculate remaining time until token expires
 * @returns Remaining time in seconds, or 0 if expired
 */
export function getTokenRemainingTime(tokens: OAuthTokens): number {
	const expiresAt = tokens?.expiresAt;
	if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return 0;
	const remaining = expiresAt - Math.floor(Date.now() / 1000);
	return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
}

/**
 * Format remaining time for display
 */
export function formatTokenExpiry(tokens: OAuthTokens): string {
	const remaining = getTokenRemainingTime(tokens);

	if (remaining <= 0) {
		return 'Expired';
	}

	const hours = Math.floor(remaining / 3600);
	const minutes = Math.floor((remaining % 3600) / 60);

	if (hours > 0) {
		return `${hours}h ${minutes}m remaining`;
	}
	return `${minutes}m remaining`;
}
