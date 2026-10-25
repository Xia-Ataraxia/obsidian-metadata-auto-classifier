import { Platform } from 'obsidian';
import { macLogger } from '../utils/mac-logger';
import { redactLogPayload, sanitizeErrorMessage, summarizeForLog } from '../utils/log-redaction';
import { sendStreamingRequestViaNode } from './streaming-node-request';

const STREAM_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;
const RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

export interface SSEEvent {
	type: string;
	[key: string]: unknown;
}

function redactUrl(url: string): string {
	try {
		const parsed = new URL(url);
		let changed = false;
		for (const key of parsed.searchParams.keys()) {
			if (/key|token|secret|code/i.test(key)) {
				parsed.searchParams.set(key, '[REDACTED]');
				changed = true;
			}
		}
		return changed ? parsed.toString() : url;
	} catch {
		return sanitizeErrorMessage(url);
	}
}

function parseSSEEvents(text: string): SSEEvent[] {
	const events: SSEEvent[] = [];

	for (const line of text.split('\n')) {
		const trimmedLine = line.trim();
		if (!trimmedLine || trimmedLine === 'data: [DONE]') {
			continue;
		}

		if (trimmedLine.startsWith('data: ')) {
			try {
				const jsonStr = trimmedLine.slice(6);
				const event = JSON.parse(jsonStr) as SSEEvent;
				events.push(event);
			} catch {
				// Skip non-JSON data lines
			}
		}
	}

	return events;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
	return RETRY_STATUS_CODES.includes(status);
}

export class HttpError extends Error {
	readonly status: number;
	readonly responseText: string;

	constructor(message: string, status: number, responseText: string) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.responseText = responseText;
	}
}

export async function sendStreamingRequest(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
	parseEvent: (event: SSEEvent) => string | null
): Promise<string> {
	if (!Platform.isDesktop) {
		throw new Error('Streaming requests are only available on desktop platforms');
	}

	macLogger.debug(
		'[API Streaming Request]',
		redactLogPayload({
			url: redactUrl(url),
			headers,
			body,
		})
	);

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const response = await sendStreamingRequestViaNode(url, headers, body, STREAM_TIMEOUT_MS);

			// Check for HTTP errors
			if (response.status >= 400) {
				// Throw HttpError for 401 so it can be caught for token refresh
				if (response.status === 401) {
					throw new HttpError(
						`Authentication failed (HTTP 401)`,
						response.status,
						sanitizeErrorMessage(response.text)
					);
				}

				// Check if we should retry for transient errors
				if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
					const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt);
					macLogger.warn(
						`[API Streaming] Retryable error (HTTP ${response.status}), attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delayMs}ms`
					);
					await delay(delayMs);
					continue;
				}

				macLogger.error(
					'[API Streaming Error]',
					new Error(`HTTP ${response.status}: ${sanitizeErrorMessage(response.text)}`)
				);
				throw new HttpError(
					`Streaming request failed (HTTP ${response.status}): ${sanitizeErrorMessage(response.text)}`,
					response.status,
					sanitizeErrorMessage(response.text)
				);
			}

			// Parse SSE events from response text
			const events = parseSSEEvents(response.text);
			let accumulatedText = '';

			for (const event of events) {
				// Check for error events
				if (event.type === 'error') {
					const errMsg = typeof event.message === 'string' ? event.message : summarizeForLog(event);
					throw new Error(`Stream error: ${errMsg}`);
				}

				const textDelta = parseEvent(event);
				if (textDelta !== null) {
					accumulatedText += textDelta;
				}
			}

			macLogger.debug('[API Streaming Response] Accumulated text length', {
				length: String(accumulatedText.length),
			});
			return accumulatedText;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Don't retry 401 errors - they need token refresh, not retry
			if (error instanceof HttpError && error.status === 401) {
				throw error;
			}

			// Retry on network errors (not HTTP errors)
			if (!(error instanceof HttpError) && attempt < MAX_RETRIES) {
				const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt);
				macLogger.warn(
					`[API Streaming] Network error, attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delayMs}ms: ${sanitizeErrorMessage(lastError.message)}`
				);
				await delay(delayMs);
				continue;
			}

			// Re-throw HttpError as-is to preserve status info
			if (error instanceof HttpError) {
				throw error;
			}

			macLogger.error('[API Streaming Error] Request failed', lastError);
			throw new Error(`Streaming request failed: ${sanitizeErrorMessage(lastError.message)}`);
		}
	}

	// Should not reach here, but TypeScript needs this for exhaustiveness
	throw lastError ?? new Error('Streaming request failed after all retries');
}
