import type { RequestUrlResponse } from 'obsidian';
import { requestUrl } from 'obsidian';
import { HttpError, sendHttpRequest, sendRequest } from '../../src/ui/request';

const url = 'https://api.test.com/v1?key=url-secret';
const headers = { Authorization: 'Bearer header-secret' };
const body = { content: 'body-secret' };

function response(
	status: number,
	text = '{"ok":true}',
	headers: Record<string, string> = {}
): RequestUrlResponse {
	return { status, text, headers, json: undefined } as RequestUrlResponse;
}

describe('HTTP provider requests', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => vi.useRealTimers());

	it('checks operation validity immediately before dispatch', async () => {
		let current = true;
		const revoked = new Error('Synthetic operation revoked');
		const result = sendHttpRequest(url, headers, body, {
			assertCurrent: () => {
				if (!current) throw revoked;
			},
		});
		current = false;
		await expect(result).rejects.toBe(revoked);
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it('preserves non-Error operation validity failures and cleans up request controls', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
		const revoked = Symbol('Synthetic operation revoked');

		await expect(
			sendHttpRequest(url, headers, body, {
				signal: controller.signal,
				assertCurrent: () => {
					throw revoked;
				},
			})
		).rejects.toBe(revoked);

		expect(requestUrl).not.toHaveBeenCalled();
		expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not retry a POST after permission is revoked during backoff', async () => {
		vi.useFakeTimers();
		let current = true;
		const revoked = new Error('Synthetic operation revoked');
		vi.mocked(requestUrl).mockResolvedValueOnce(response(429));
		const assertion = expect(
			sendHttpRequest(url, headers, body, {
				assertCurrent: () => {
					if (!current) throw revoked;
				},
			})
		).rejects.toBe(revoked);
		await vi.advanceTimersByTimeAsync(0);
		current = false;
		await vi.advanceTimersByTimeAsync(1_000);
		await assertion;
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('rejects a successful response whose operation has been revoked', async () => {
		let current = true;
		const revoked = new Error('Synthetic operation revoked');
		vi.mocked(requestUrl).mockImplementationOnce(async () => {
			current = false;
			return response(200);
		});
		await expect(
			sendHttpRequest(url, headers, body, {
				assertCurrent: () => {
					if (!current) throw revoked;
				},
			})
		).rejects.toBe(revoked);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('does not start a POST when the deadline expires before its dispatch microtask', async () => {
		vi.useFakeTimers();
		const deadline = Date.now() + 25;
		const assertion = expect(
			sendHttpRequest(url, headers, body, { deadline })
		).rejects.toMatchObject({ code: 'TIMEOUT' });
		vi.setSystemTime(deadline);
		await assertion;
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it.each([101, 302, 399])('does not treat HTTP %i as successful inference', async (status) => {
		vi.mocked(requestUrl).mockResolvedValueOnce(response(status));
		await expect(sendHttpRequest(url, headers, body)).rejects.toMatchObject({
			code: 'PROTOCOL_ERROR',
		});
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('sends a typed native RequestUrlParam with throw:false and returns the native response', async () => {
		const nativeResponse = response(200);
		vi.mocked(requestUrl).mockResolvedValueOnce(nativeResponse);

		await expect(sendHttpRequest(url, headers, body)).resolves.toBe(nativeResponse);
		expect(requestUrl).toHaveBeenCalledWith({
			url,
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			throw: false,
		});
	});

	it('parses successful JSON through the sendRequest wrapper', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(response(200, '{"answer":42}'));

		await expect(sendRequest(url, headers, body)).resolves.toEqual({ answer: 42 });
	});

	it.each([400, 401, 403, 413, 415, 422, 500, 501, 502, 503, 504, 599])(
		'rejects HTTP %i without exposing response content or retrying',
		async (status) => {
			vi.mocked(requestUrl).mockResolvedValueOnce(response(status, 'body-secret response-secret'));

			const error = await sendHttpRequest(url, headers, body).catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(HttpError);
			expect(error).toMatchObject({ status, code: 'HTTP_ERROR' });
			expect((error as Error).message).not.toContain('secret');
			expect('responseText' in (error as object)).toBe(false);
			expect(requestUrl).toHaveBeenCalledTimes(1);
		}
	);

	it.each([429, 529])(
		'retries explicit HTTP %i once and returns the successful response',
		async (status) => {
			const success = response(200);
			vi.mocked(requestUrl)
				.mockResolvedValueOnce(response(status, 'secret retry response', { 'Retry-After': '0' }))
				.mockResolvedValueOnce(success);

			await expect(sendHttpRequest(url, headers, body)).resolves.toBe(success);
			expect(requestUrl).toHaveBeenCalledTimes(2);
		}
	);

	it('bounds Retry-After and makes at most three total attempts', async () => {
		vi.useFakeTimers();
		vi.mocked(requestUrl)
			.mockResolvedValueOnce(response(429, '', { 'Retry-After': '900' }))
			.mockResolvedValueOnce(response(529, '', { 'Retry-After': '900' }))
			.mockResolvedValueOnce(response(429, '', { 'Retry-After': '900' }));

		const request = sendHttpRequest(url, headers, body);
		const rejection = expect(request).rejects.toMatchObject({ status: 429, code: 'HTTP_ERROR' });
		await vi.advanceTimersByTimeAsync(4_999);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(requestUrl).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(5_000);
		await rejection;
		expect(requestUrl).toHaveBeenCalledTimes(3);
	});

	it('does not retry when the shared deadline expires during backoff', async () => {
		vi.useFakeTimers();
		vi.mocked(requestUrl).mockResolvedValueOnce(response(429, '', { 'Retry-After': '5' }));
		const deadline = Date.now() + 1_000;
		const request = sendHttpRequest(url, headers, body, { deadline });
		const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });

		await vi.advanceTimersByTimeAsync(1_000);
		await rejection;
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('turns invalid JSON into a safe error', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(response(200, 'body-secret invalid-json'));

		await expect(sendRequest(url, headers, body)).rejects.toMatchObject({ code: 'INVALID_JSON' });
	});

	it('sanitizes transport errors and never logs URL, headers, body, or response payload', async () => {
		const consoleError = vi.spyOn(console, 'error');
		vi.mocked(requestUrl).mockRejectedValueOnce(
			new Error(`${url} ${headers.Authorization} ${body.content} transport-secret`)
		);

		const error = await sendRequest(url, headers, body).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({ code: 'TRANSPORT_ERROR' });
		expect((error as Error).message).not.toContain('secret');
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('times out an in-flight POST without retrying and rejects a late response', async () => {
		vi.useFakeTimers();
		let resolveRequest!: (value: RequestUrlResponse) => void;
		vi.mocked(requestUrl).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRequest = resolve;
			})
		);
		const request = sendHttpRequest(url, headers, body, { deadline: Date.now() + 100 });
		const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });

		await vi.advanceTimersByTimeAsync(100);
		await rejection;
		resolveRequest(response(200));
		await Promise.resolve();
		await Promise.resolve();
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('reports timeout when a native rejection arrives after the deadline before its timer runs', async () => {
		vi.useFakeTimers();
		let rejectRequest!: (reason?: unknown) => void;
		vi.mocked(requestUrl).mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				rejectRequest = reject;
			})
		);
		const deadline = Date.now() + 100;
		const request = sendHttpRequest(url, headers, body, { deadline });
		const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });

		await vi.advanceTimersByTimeAsync(0);
		vi.setSystemTime(deadline);
		rejectRequest(new Error('Synthetic native rejection'));

		await rejection;
		expect(requestUrl).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('sends a string request body verbatim for URL-encoded forms', async () => {
		const formBody =
			'grant_type=authorization_code&code=code%2Bvalue&redirect_uri=app%3A%2F%2Fcallback';
		vi.mocked(requestUrl).mockResolvedValueOnce(response(200));

		await expect(
			sendRequest(url, { 'Content-Type': 'application/x-www-form-urlencoded' }, formBody, {
				maxAttempts: 1,
			})
		).resolves.toEqual({ ok: true });

		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ body: formBody, method: 'POST' })
		);
	});

	it.each([429, 529])('does not retry HTTP %i when maxAttempts is one', async (status) => {
		vi.mocked(requestUrl).mockResolvedValueOnce(response(status));

		await expect(sendHttpRequest(url, headers, body, { maxAttempts: 1 })).rejects.toMatchObject({
			status,
			code: 'HTTP_ERROR',
		});
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it.each([0, 2, 4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		'rejects invalid runtime maxAttempts %s before serialization or dispatch',
		async (maxAttempts) => {
			const toJSON = vi.fn(() => ({ secret: true }));
			const options = { maxAttempts } as unknown as Parameters<typeof sendHttpRequest>[3];

			await expect(sendHttpRequest(url, headers, { toJSON }, options)).rejects.toMatchObject({
				code: 'PROTOCOL_ERROR',
			});
			expect(toJSON).not.toHaveBeenCalled();
			expect(requestUrl).not.toHaveBeenCalled();
		}
	);

	it('rejects an already-aborted request before serializing or dispatching', async () => {
		const controller = new AbortController();
		const toJSON = vi.fn(() => ({ secret: true }));
		controller.abort();

		await expect(
			sendHttpRequest(url, headers, { toJSON }, { signal: controller.signal })
		).rejects.toMatchObject({ code: 'CANCELLED' });
		expect(toJSON).not.toHaveBeenCalled();
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it('aborts a pending native request promptly and ignores its late response', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const addListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
		let resolveRequest!: (value: RequestUrlResponse) => void;
		vi.mocked(requestUrl).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRequest = resolve;
			})
		);
		const request = sendHttpRequest(url, headers, body, { signal: controller.signal });

		await vi.advanceTimersByTimeAsync(0);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		controller.abort();
		await expect(request).rejects.toMatchObject({ code: 'CANCELLED' });
		expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);

		resolveRequest(response(200));
		await vi.advanceTimersByTimeAsync(0);
		expect(addListener).toHaveBeenCalledTimes(1);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('rejects cancellation when the signal aborts as the native response arrives', async () => {
		const controller = new AbortController();
		vi.mocked(requestUrl).mockImplementationOnce(() => {
			controller.abort();
			return Promise.resolve(response(200));
		});

		await expect(
			sendHttpRequest(url, headers, body, { signal: controller.signal })
		).rejects.toMatchObject({ code: 'CANCELLED' });
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('cleans up the deadline timer and abort listener after success', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const addListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
		vi.mocked(requestUrl).mockResolvedValueOnce(response(200));

		await sendHttpRequest(url, headers, body, { signal: controller.signal });

		expect(addListener).toHaveBeenCalledTimes(1);
		expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});

	it('aborts retry backoff and never dispatches another POST', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
		vi.mocked(requestUrl).mockResolvedValueOnce(response(429, '', { 'Retry-After': '5' }));
		const request = sendHttpRequest(url, headers, body, { signal: controller.signal });

		await vi.advanceTimersByTimeAsync(0);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		controller.abort();
		await expect(request).rejects.toMatchObject({ code: 'CANCELLED' });
		expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});
});
