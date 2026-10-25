const MAX_LOG_FIELD_LENGTH = 160;
const SENSITIVE_KEY_PATTERN =
	/authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|code[_-]?verifier|oauth|password|prompt|body|content|messages|input|instructions|payload/i;
const TOKEN_VALUE_PATTERN = /Bearer\s+[A-Za-z0-9._~+\-/]+=*|sk-[A-Za-z0-9_-]+/gi;

export function redactLogValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return truncateLogString(value.replace(TOKEN_VALUE_PATTERN, '[REDACTED]'));
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactLogValue(item));
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactLogValue(item),
			])
		);
	}
	return value;
}

export function redactLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
	return redactLogValue(payload) as Record<string, unknown>;
}

export function summarizeForLog(value: unknown): string {
	return JSON.stringify(redactLogValue(value));
}

export function sanitizeErrorMessage(message: string): string {
	return truncateLogString(message.replace(TOKEN_VALUE_PATTERN, '[REDACTED]'));
}

const MAX_NOTICE_LENGTH = 120;

// Notices show one calm line; raw response bodies and URLs stay in the log
export function toNoticeMessage(message: string): string {
	const [head = message] = message.split(/\.?\s+Raw content:|\s+from https?:\/\//);
	const summary = head
		.replace(TOKEN_VALUE_PATTERN, '[REDACTED]')
		.replace(/\s+/g, ' ')
		.trim();
	return summary.length <= MAX_NOTICE_LENGTH ? summary : `${summary.slice(0, MAX_NOTICE_LENGTH - 1)}…`;
}

function truncateLogString(value: string): string {
	if (value.length <= MAX_LOG_FIELD_LENGTH) return value;
	return `${value.slice(0, MAX_LOG_FIELD_LENGTH)}…[truncated ${value.length - MAX_LOG_FIELD_LENGTH} chars]`;
}
