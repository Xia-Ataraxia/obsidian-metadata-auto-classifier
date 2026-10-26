// Matches the plugin's own Codex OAuth errors (UnifiedProvider, CodexOAuth.refreshTokens)
const RECONNECT_ERROR_PATTERN = /OAuth tokens (not found|incomplete)|Token refresh failed/;
// Thrown before any request when the provider has no usable key (UnifiedProvider.resolveApiKey).
const MISSING_AUTH_ERROR_PATTERN = /^Provider authentication is unavailable$/;
const NETWORK_ERROR_PATTERN = /net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Failed to fetch|NetworkError/i;

function getStatus(error: unknown, message: string): number | undefined {
	const status = ownValue(error, 'status');
	if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) return status;
	const match = /status (\d{3})|HTTP (\d{3})/.exec(message);
	const parsed = match ? Number(match[1] ?? match[2]) : undefined;
	return parsed !== undefined && parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

function ownValue(error: unknown, key: string): unknown {
	if (typeof error !== 'object' || error === null) return undefined;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, key);
		return descriptor && 'value' in descriptor ? descriptor.value : undefined;
	} catch {
		return undefined;
	}
}

// Neither notices nor diagnostics disclose raw errors; avoid invoking arbitrary getters/stringifiers.
export function toApiErrorNotice(error: unknown, provider: string): string {
	const rawMessage = typeof error === 'string' ? error : ownValue(error, 'message');
	const message = typeof rawMessage === 'string' ? rawMessage : '';
	// These carry no trustworthy status: OAuth failures may wrap a 401, parse errors embed raw note text.
	if (RECONNECT_ERROR_PATTERN.test(message)) return `Reconnect your ${provider} account in settings.`;
	if (MISSING_AUTH_ERROR_PATTERN.test(message)) return `Add an API key for ${provider} in settings.`;
	if (message.startsWith('Failed to parse')) return `${provider} returned an unexpected response. Try again.`;
	const status = getStatus(error, message);

	if (status === 401 || status === 403) return `Request failed (${status}). Check the API key for ${provider}.`;
	if (status === 429) return 'Rate limited. Try again in a moment.';
	if (status !== undefined && status >= 500) return `${provider} is unavailable (${status}). Try again later.`;
	if (status !== undefined) return `Request to ${provider} failed (${status}).`;
	if (NETWORK_ERROR_PATTERN.test(message)) return `Couldn't reach ${provider}.`;
	return 'Request failed. Please try again.';
}
