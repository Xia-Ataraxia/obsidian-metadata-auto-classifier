import { Component, type RequestUrlResponse } from 'obsidian';

export type HttpErrorCode =
	| 'HTTP_ERROR'
	| 'TRANSPORT_ERROR'
	| 'PROTOCOL_ERROR'
	| 'INVALID_JSON'
	| 'TIMEOUT'
	| 'CANCELLED';

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
	/** Aborts this request without claiming physical cancellation of an in-flight native request. */
	signal?: AbortSignal;
	/** Maximum total attempts; only HTTP 429 and 529 responses are retried. */
	maxAttempts?: 1 | 3;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new HttpError('CANCELLED');
}

function createDeadlineControl(
	deadline: number,
	signal?: AbortSignal
): {
	promise: Promise<never>;
	cleanup: () => void;
} {
	let timer: number | undefined;
	let listenerRegistered = false;
	const scope = new Component();
	scope.load();
	let rejectControl!: (error: HttpError) => void;
	const onAbort = (): void => rejectControl(new HttpError('CANCELLED'));
	const promise = new Promise<never>((_resolve, reject) => {
		rejectControl = (error) => reject(error);
		if (signal?.aborted) {
			rejectControl(new HttpError('CANCELLED'));
			return;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			rejectControl(new HttpError('TIMEOUT'));
			return;
		}

		listenerRegistered = signal !== undefined;
		signal?.addEventListener('abort', onAbort);
		timer = window.setTimeout(() => rejectControl(new HttpError('TIMEOUT')), remaining);
		if (signal?.aborted) onAbort();
	});
	scope.register(() => {
		if (timer !== undefined) window.clearTimeout(timer);
		if (listenerRegistered) signal?.removeEventListener('abort', onAbort);
	});
	const cleanup = (): void => scope.unload();
	return { promise, cleanup };
}

export function requestBeforeDeadline(
	dispatch: () => Promise<RequestUrlResponse>,
	deadline: number,
	signal?: AbortSignal,
	assertCurrent?: () => void
): Promise<RequestUrlResponse> {
	const control = createDeadlineControl(deadline, signal);
	const guardedDispatch = Promise.resolve().then(async () => {
		throwIfAborted(signal);
		if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
		assertCurrent?.();
		throwIfAborted(signal);
		if (Date.now() >= deadline) throw new HttpError('TIMEOUT');

		let response: RequestUrlResponse;
		try {
			response = await dispatch();
		} catch {
			throwIfAborted(signal);
			if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
			throw new HttpError('TRANSPORT_ERROR');
		}

		throwIfAborted(signal);
		if (Date.now() >= deadline) throw new HttpError('TIMEOUT');
		return response;
	});
	return Promise.race([guardedDispatch, control.promise]).finally(control.cleanup);
}

export function waitBeforeDeadline(
	delayMs: number,
	deadline: number,
	signal?: AbortSignal
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: number | undefined;
		let listenerRegistered = false;
		const scope = new Component();
		scope.load();
		const cleanup = (): void => scope.unload();
		const resolveOnce = (): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};
		const rejectOnce = (error: HttpError): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onAbort = (): void => rejectOnce(new HttpError('CANCELLED'));
		scope.register(() => {
			if (timer !== undefined) window.clearTimeout(timer);
			if (listenerRegistered) signal?.removeEventListener('abort', onAbort);
		});

		if (signal?.aborted) {
			rejectOnce(new HttpError('CANCELLED'));
			return;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			rejectOnce(new HttpError('TIMEOUT'));
			return;
		}

		listenerRegistered = signal !== undefined;
		signal?.addEventListener('abort', onAbort);
		timer = window.setTimeout(
			() => {
				if (signal?.aborted) rejectOnce(new HttpError('CANCELLED'));
				else if (Date.now() >= deadline) rejectOnce(new HttpError('TIMEOUT'));
				else resolveOnce();
			},
			Math.min(delayMs, remaining)
		);
		if (signal?.aborted) onAbort();
	});
}
