export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasCredentialString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

export function hasOAuthCredential(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasCredentialString(value.accessToken) &&
		hasCredentialString(value.refreshToken) &&
		hasCredentialString(value.accountId) &&
		typeof value.expiresAt === 'number' &&
		Number.isFinite(value.expiresAt)
	);
}
