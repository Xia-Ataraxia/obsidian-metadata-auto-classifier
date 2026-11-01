import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { requestUrl } from 'obsidian';
import {
	HttpError,
	requestBeforeDeadline,
	throwIfAborted,
	waitBeforeDeadline,
	type HttpRequestOptions,
} from './request-control';

export { HttpError } from './request-control';
export type { HttpErrorCode, HttpRequestOptions } from './request-control';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5_000;

function createRequestParam(
	url: string,
	headers: Record<string, string>,
	data: object | string
): RequestUrlParam {
	let serialized: string;
	if (typeof data === 'string') {
		serialized = data;
	} else {
		let json: string | undefined;
		try {
			json = JSON.stringify(data);
		} catch {
			throw new HttpError('PROTOCOL_ERROR');
		}
		if (typeof json !== 'string') throw new HttpError('PROTOCOL_ERROR');
		serialized = json;
	}

	return { url, method: 'POST', headers, body: serialized, throw: false };
}

function retryDelay(response: RequestUrlResponse, attempt: number): number {
	const retryAfter = Object.entries(response.headers ?? {}).find(
		([name]) => name.toLowerCase() === 'retry-after'
	)?.[1];
	let requestedDelay: number | undefined;
	if (retryAfter && /^\d+$/.test(retryAfter)) {
		requestedDelay = Number(retryAfter) * 1000;
	} else if (retryAfter) {
		const retryAt = Date.parse(retryAfter);
		if (Number.isFinite(retryAt)) requestedDelay = Math.max(0, retryAt - Date.now());
	}

	const backoff = Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
	return Math.min(requestedDelay ?? backoff, MAX_RETRY_AFTER_MS);
}

export async function sendHttpRequest(
	url: string,
	headers: Record<string, string>,
	data: object | string,
	options?: HttpRequestOptions
): Promise<RequestUrlResponse> {
	const startedAt = Date.now();
	throwIfAborted(options?.signal);
	const requestedMaxAttempts = options?.maxAttempts;
	if (
		requestedMaxAttempts !== undefined &&
		requestedMaxAttempts !== 1 &&
		requestedMaxAttempts !== MAX_ATTEMPTS
	) {
		throw new HttpError('PROTOCOL_ERROR');
	}
	const deadline = Math.min(
		options?.deadline ?? startedAt + REQUEST_TIMEOUT_MS,
		startedAt + REQUEST_TIMEOUT_MS
	);
	if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new HttpError('TIMEOUT');
	const param = createRequestParam(url, headers, data);
	throwIfAborted(options?.signal);
	const maxAttempts = requestedMaxAttempts ?? MAX_ATTEMPTS;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const response = await requestBeforeDeadline(
			() => requestUrl(param),
			deadline,
			options?.signal,
			options?.assertCurrent
		);
		throwIfAborted(options?.signal);
		if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
		options?.assertCurrent?.();
		throwIfAborted(options?.signal);
		if (typeof response !== 'object' || response === null) {
			throw new HttpError('PROTOCOL_ERROR');
		}
		if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
			throw new HttpError('PROTOCOL_ERROR');
		}
		if (response.status >= 400) {
			if ((response.status === 429 || response.status === 529) && attempt < maxAttempts) {
				await waitBeforeDeadline(retryDelay(response, attempt), deadline, options?.signal);
				throwIfAborted(options?.signal);
				continue;
			}
			throw new HttpError('HTTP_ERROR', response.status);
		}
		if (response.status < 200 || response.status >= 300) throw new HttpError('PROTOCOL_ERROR');
		throwIfAborted(options?.signal);
		return response;
	}

	throw new HttpError('PROTOCOL_ERROR');
}

export async function sendRequest(
	url: string,
	headers: Record<string, string>,
	data: object | string,
	options?: HttpRequestOptions
): Promise<unknown> {
	const response = await sendHttpRequest(url, headers, data, options);
	throwIfAborted(options?.signal);
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.text) as unknown;
	} catch {
		throw new HttpError('INVALID_JSON');
	}
	throwIfAborted(options?.signal);
	return parsed;
}
