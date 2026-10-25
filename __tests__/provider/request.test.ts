import { Platform, requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import { HttpError } from 'provider/request';
import { sendStreamingRequest } from '../../src/ui/streaming-request';
import type { SSEEvent, SSEEventOutcome } from '../../src/ui/streaming-request';

const url = 'https://api.test.com/stream?token=url-secret';
const headers = { Authorization: 'Bearer header-secret' };
const body = { prompt: 'body-secret' };

function response(status: number, text: string): RequestUrlResponse {
	return { status, text, headers: {}, json: undefined } as RequestUrlResponse;
}

function eventFrame(event: unknown): string {
	return `data: ${JSON.stringify(event)}\r\n\r\n`;
}

function parseTestEvent(event: SSEEvent): SSEEventOutcome {
	if (event.type === 'text.delta') {
		return typeof event.delta === 'string'
			? { type: 'delta', text: event.delta }
			: { type: 'error' };
	}
	if (event.type === 'response.completed') {
		return event.response && (event.response as Record<string, unknown>).status === 'completed'
			? { type: 'complete' }
			: { type: 'error' };
	}
	if (
		event.type === 'response.failed' ||
		event.type === 'response.incomplete' ||
		event.type.startsWith('response.refusal.') ||
		event.type === 'error'
	) {
		return { type: 'error' };
	}
	return { type: 'ignore' };
}

const completed = eventFrame({
	type: 'response.completed',
	response: { status: 'completed', output: [] },
});

describe('sendStreamingRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Platform.isDesktop = true;
	});
	afterEach(() => vi.useRealTimers());

	it('rejects an expired shared deadline before sending any request', async () => {
		await expect(
			sendStreamingRequest(url, headers, body, parseTestEvent, { deadline: Date.now() })
		).rejects.toMatchObject({ code: 'TIMEOUT' });
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it('uses the remaining shared deadline rather than starting a new minute', async () => {
		vi.useFakeTimers();
		vi.mocked(requestUrl).mockReturnValueOnce(new Promise(() => undefined));
		const assertion = expect(
			sendStreamingRequest(url, headers, body, parseTestEvent, { deadline: Date.now() + 25 })
		).rejects.toMatchObject({ code: 'TIMEOUT' });
		await vi.advanceTimersByTimeAsync(25);
		await assertion;
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('parses CRLF frames and joins multiple data lines before JSON parsing', async () => {
		const stream =
			': keep-alive\r\n\r\n' +
			'data: {"type":"text.delta","delta":\r\n' +
			'data: "Hello"}\r\n\r\n' +
			'data: {"type":"text.delta","delta":" World"}\r\n\r\n' +
			completed;
		vi.mocked(requestUrl).mockResolvedValueOnce(response(200, stream));

		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).resolves.toBe(
			'Hello World'
		);
	});

	it('uses the same native adapter on mobile platforms', async () => {
		Platform.isDesktop = false;
		vi.mocked(requestUrl).mockResolvedValueOnce(
			response(200, eventFrame({ type: 'text.delta', delta: 'mobile' }) + completed)
		);

		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).resolves.toBe('mobile');
		expect(requestUrl).toHaveBeenCalledTimes(1);
		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ throw: false, method: 'POST' })
		);
	});

	it.each(['response.failed', 'response.incomplete', 'response.refusal.delta', 'error'])(
		'rejects terminal provider event %s without returning partial text',
		async (type) => {
			vi.mocked(requestUrl).mockResolvedValueOnce(
				response(200, eventFrame({ type: 'text.delta', delta: 'partial' }) + eventFrame({ type }))
			);

			await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).rejects.toMatchObject({
				code: 'PROTOCOL_ERROR',
			});
			expect(requestUrl).toHaveBeenCalledTimes(1);
		}
	);

	it('rejects malformed JSON and does not retransmit the POST', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(
			response(200, 'data: {"type":invalid,"delta":"partial"}\n\n' + completed)
		);

		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).rejects.toMatchObject({
			code: 'PROTOCOL_ERROR',
		});
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('rejects an unfinished frame instead of accepting buffered partial data', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(
			response(
				200,
				eventFrame({ type: 'text.delta', delta: 'partial' }) + 'data: {"type":"response.completed"}'
			)
		);

		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).rejects.toMatchObject({
			code: 'PROTOCOL_ERROR',
		});
	});

	it('rejects a stream without successful terminal completion', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(
			response(200, eventFrame({ type: 'text.delta', delta: 'partial' }))
		);

		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).rejects.toMatchObject({
			code: 'PROTOCOL_ERROR',
		});
	});

	it('rejects empty or whitespace-only completed output', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(response(200, completed));
		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).rejects.toMatchObject({
			code: 'PROTOCOL_ERROR',
		});

		vi.mocked(requestUrl).mockResolvedValueOnce(
			response(200, eventFrame({ type: 'text.delta', delta: '  ' }) + completed)
		);
		await expect(sendStreamingRequest(url, headers, body, parseTestEvent)).rejects.toMatchObject({
			code: 'PROTOCOL_ERROR',
		});
	});

	it('rejects callback failures with a safe protocol error', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(
			response(200, eventFrame({ type: 'text.delta', delta: 'partial' }) + completed)
		);
		const parser = () => {
			throw new Error(`${url} ${headers.Authorization} ${body.prompt}`);
		};

		const error = await sendStreamingRequest(url, headers, body, parser).catch(
			(caught: unknown) => caught
		);
		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({ code: 'PROTOCOL_ERROR' });
		expect((error as Error).message).not.toContain('secret');
	});

	it('preserves safe HttpError identity and HTTP status for 401 without retrying', async () => {
		vi.mocked(requestUrl).mockResolvedValueOnce(response(401, 'header-secret body-secret'));

		const error = await sendStreamingRequest(url, headers, body, parseTestEvent).catch(
			(caught: unknown) => caught
		);
		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({ status: 401, code: 'HTTP_ERROR' });
		expect((error as Error).message).not.toContain('secret');
		expect('responseText' in (error as object)).toBe(false);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});
});
