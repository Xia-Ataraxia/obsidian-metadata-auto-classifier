import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { requestUrl } from 'obsidian';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5_000;

export type HttpErrorCode =
	| 'HTTP_ERROR'
	| 'TRANSPORT_ERROR'
	| 'PROTOCOL_ERROR'
	| 'INVALID_JSON'
	| 'TIMEOUT';

export class HttpError extends Error {
	readonly status: number | undefined;
	readonly code: HttpErrorCode;

	constructor(code: HttpErrorCode, status?: number) {
		const message =
			code === 'HTTP_ERROR' && status !== undefined
				? `HTTP request failed (HTTP ${status})`
				: `Request failed (${code})`;
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.code = code;
	}
}

export interface HttpRequestOptions {
	/** Absolute deadline in milliseconds since the Unix epoch. */
	deadline?: number;
	/** Synchronous operation validity check before every dispatch and after every response. */
	assertCurrent?: () => void;
}

function createRequestParam(
	url: string,
	headers: Record<string, string>,
	data: object
): RequestUrlParam {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(data);
	} catch {
		throw new HttpError('PROTOCOL_ERROR');
	}
	if (typeof serialized !== 'string') throw new HttpError('PROTOCOL_ERROR');

	return { url, method: 'POST', headers, body: serialized, throw: false };
}

function requestBeforeDeadline(
	param: RequestUrlParam,
	deadline: number,
	assertCurrent?: () => void
): Promise<RequestUrlResponse> {
	return new Promise((resolve, reject) => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			reject(new HttpError('TIMEOUT'));
			return;
		}

		let settled = false;
		let guardFailed = false;
		let guardError: unknown;
		const timer = setTimeout(() => finish(reject, new HttpError('TIMEOUT')), remaining);
		const finish = <T>(callback: (value: T) => void, value: T): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			callback(value);
		};

		Promise.resolve()
			.then(() => {
				if (settled || Date.now() >= deadline) throw new HttpError('TIMEOUT');
				try {
					assertCurrent?.();
				} catch (error) {
					guardFailed = true;
					guardError = error;
					throw error;
				}
				return requestUrl(param);
			})
			.then(
				(response) => {
					if (Date.now() >= deadline) {
						finish(reject, new HttpError('TIMEOUT'));
					} else {
						finish(resolve, response);
					}
				},
				() =>
					finish(
						reject,
						guardFailed
							? guardError
							: new HttpError(Date.now() >= deadline ? 'TIMEOUT' : 'TRANSPORT_ERROR')
					)
			);
	});
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

async function waitBeforeDeadline(delayMs: number, deadline: number): Promise<void> {
	const remaining = deadline - Date.now();
	if (remaining <= 0) throw new HttpError('TIMEOUT');
	if (delayMs >= remaining) {
		await new Promise<void>((resolve) => setTimeout(resolve, remaining));
		throw new HttpError('TIMEOUT');
	}
	await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
	if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
}

export async function sendHttpRequest(
	url: string,
	headers: Record<string, string>,
	data: object,
	options?: HttpRequestOptions
): Promise<RequestUrlResponse> {
	const startedAt = Date.now();
	const deadline = Math.min(
		options?.deadline ?? startedAt + REQUEST_TIMEOUT_MS,
		startedAt + REQUEST_TIMEOUT_MS
	);
	if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new HttpError('TIMEOUT');
	const param = createRequestParam(url, headers, data);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const response = await requestBeforeDeadline(param, deadline, options?.assertCurrent);
		if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
		options?.assertCurrent?.();
		if (typeof response !== 'object' || response === null) {
			throw new HttpError('PROTOCOL_ERROR');
		}
		if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
			throw new HttpError('PROTOCOL_ERROR');
		}
		if (response.status >= 400) {
			if ((response.status === 429 || response.status === 529) && attempt < MAX_ATTEMPTS) {
				await waitBeforeDeadline(retryDelay(response, attempt), deadline);
				continue;
			}
			throw new HttpError('HTTP_ERROR', response.status);
		}
		if (response.status < 200 || response.status >= 300) throw new HttpError('PROTOCOL_ERROR');
		return response;
	}

	throw new HttpError('PROTOCOL_ERROR');
}

export async function sendRequest(
	url: string,
	headers: Record<string, string>,
	data: object,
	options?: HttpRequestOptions
): Promise<unknown> {
	const response = await sendHttpRequest(url, headers, data, options);
	try {
		return JSON.parse(response.text) as unknown;
	} catch {
		throw new HttpError('INVALID_JSON');
	}
}
