import { HttpError, sendHttpRequest } from './request';
import type { HttpRequestOptions } from './request';

export interface SSEEvent {
	type: string;
	[key: string]: unknown;
}

export type SSEEventOutcome =
	| { type: 'delta'; text: string }
	| { type: 'complete' }
	| { type: 'ignore' }
	| { type: 'error' };

function parseEventData(data: string): SSEEvent {
	let event: unknown;
	try {
		event = JSON.parse(data) as unknown;
	} catch {
		throw new HttpError('PROTOCOL_ERROR');
	}
	if (typeof event !== 'object' || event === null || Array.isArray(event)) {
		throw new HttpError('PROTOCOL_ERROR');
	}
	if (typeof (event as Record<string, unknown>).type !== 'string') {
		throw new HttpError('PROTOCOL_ERROR');
	}
	return event as SSEEvent;
}

function parseSSE(text: string, parseEvent: (event: SSEEvent) => SSEEventOutcome): string {
	const lines = text.split(/\r\n|\r|\n/);
	let frameHasField = false;
	let dataLines: string[] = [];
	let accumulatedText = '';
	let completed = false;

	const consumeFrame = (): void => {
		if (dataLines.length === 0) return;
		if (completed) throw new HttpError('PROTOCOL_ERROR');
		const event = parseEventData(dataLines.join('\n'));
		let outcome: SSEEventOutcome;
		try {
			outcome = parseEvent(event);
		} catch {
			throw new HttpError('PROTOCOL_ERROR');
		}
		if (!outcome || typeof outcome !== 'object') throw new HttpError('PROTOCOL_ERROR');
		switch (outcome.type) {
			case 'delta':
				if (typeof outcome.text !== 'string') throw new HttpError('PROTOCOL_ERROR');
				accumulatedText += outcome.text;
				break;
			case 'complete':
				completed = true;
				break;
			case 'ignore':
				break;
			case 'error':
			default:
				throw new HttpError('PROTOCOL_ERROR');
		}
	};

	for (const line of lines) {
		if (line === '') {
			consumeFrame();
			frameHasField = false;
			dataLines = [];
			continue;
		}
		if (line.startsWith(':')) continue;
		frameHasField = true;
		const separator = line.indexOf(':');
		const field = separator === -1 ? line : line.slice(0, separator);
		if (field === 'data') {
			let value = separator === -1 ? '' : line.slice(separator + 1);
			if (value.startsWith(' ')) value = value.slice(1);
			dataLines.push(value);
		}
	}

	if (frameHasField || dataLines.length > 0) throw new HttpError('PROTOCOL_ERROR');
	if (!completed || accumulatedText.trim().length === 0) throw new HttpError('PROTOCOL_ERROR');
	return accumulatedText;
}

export async function sendStreamingRequest(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
	parseEvent: (event: SSEEvent) => SSEEventOutcome,
	options?: HttpRequestOptions
): Promise<string> {
	const deadline = Math.min(options?.deadline ?? Infinity, Date.now() + 60_000);
	const response = await sendHttpRequest(url, headers, body, { ...options, deadline });
	if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
	if (typeof response.text !== 'string') throw new HttpError('PROTOCOL_ERROR');
	const text = parseSSE(response.text, parseEvent);
	if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
	return text;
}
