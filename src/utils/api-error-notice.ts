// Matches the plugin's own Codex OAuth errors (UnifiedProvider, CodexOAuth.refreshTokens)
const RECONNECT_ERROR_PATTERN = /OAuth tokens (not found|incomplete)|Token refresh failed/;
const NETWORK_ERROR_PATTERN = /net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Failed to fetch|NetworkError/i;

function getStatus(error: unknown, message: string): number | undefined {
	const status = (error as { status?: unknown } | null)?.status;
	if (typeof status === 'number') return status;
	const match = /status (\d{3})|HTTP (\d{3})/.exec(message);
	return match ? Number(match[1] ?? match[2]) : undefined;
}

// Notices never show request URLs, response bodies, or raw error text; the full error goes to the console
export function toApiErrorNotice(error: unknown, provider: string): string {
	const message = error instanceof Error ? error.message : String(error);
	const status = getStatus(error, message);

	if (status === 401 || status === 403) return `Request failed (${status}). Check the API key for ${provider}.`;
	if (status === 429) return 'Rate limited. Try again in a moment.';
	if (status !== undefined && status >= 500) return `${provider} is unavailable (${status}). Try again later.`;
	if (status !== undefined) return `Request to ${provider} failed (${status}).`;
	if (RECONNECT_ERROR_PATTERN.test(message)) return `Reconnect your ${provider} account in settings.`;
	if (NETWORK_ERROR_PATTERN.test(message)) return `Couldn't reach ${provider}.`;
	if (message.startsWith('Failed to parse')) return `${provider} returned an unexpected response. Try again.`;
	return 'Classification failed. See the console for details.';
}
