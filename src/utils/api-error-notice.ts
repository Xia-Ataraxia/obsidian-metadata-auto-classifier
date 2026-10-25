const MAX_NOTICE_LENGTH = 120;
const NETWORK_ERROR_PATTERN = /net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Failed to fetch|NetworkError/i;
const TOKEN_VALUE_PATTERN = /Bearer\s+[A-Za-z0-9._~+\-/]+=*|sk-[A-Za-z0-9_-]+/gi;

function getStatus(error: unknown, message: string): number | undefined {
	const status = (error as { status?: unknown } | null)?.status;
	if (typeof status === 'number') return status;
	const match = /status (\d{3})|HTTP (\d{3})/.exec(message);
	return match ? Number(match[1] ?? match[2]) : undefined;
}

// Notices never show request URLs or response bodies; the full error goes to the console
export function toApiErrorNotice(error: unknown, provider: string): string {
	const message = error instanceof Error ? error.message : String(error);
	const status = getStatus(error, message);

	if (status === 401 || status === 403) return `Request failed (${status}). Check the API key for ${provider}.`;
	if (status === 429) return 'Rate limited. Try again in a moment.';
	if (status !== undefined && status >= 500) return `${provider} is unavailable (${status}). Try again later.`;
	if (status !== undefined) return `Request to ${provider} failed (${status}).`;
	if (NETWORK_ERROR_PATTERN.test(message)) return `Couldn't reach ${provider}.`;
	if (message.startsWith('Failed to parse')) return `${provider} sent a response that couldn't be read.`;

	const [head = message] = message.split(/\.?\s+Raw content:|\s+from https?:\/\//);
	const summary = head.replace(TOKEN_VALUE_PATTERN, '[REDACTED]').replace(/\s+/g, ' ').trim();
	return summary.length <= MAX_NOTICE_LENGTH ? summary : `${summary.slice(0, MAX_NOTICE_LENGTH - 1)}…`;
}
