import { PROVIDER_NAMES } from '../../src/utils/lib-utils';
import type { ProviderConfig } from '../../src/types';
import { TAG_GENERATION_SCHEMA } from '../../src/domain/constants';
import { HttpError, sendRequest } from '../../src/ui/request';
import { sendStreamingRequest } from '../../src/ui/streaming-request';
import { UnifiedProvider } from '../../src/ui/UnifiedProvider';
import { CODEX_OAUTH } from '../../src/domain/auth/oauth-constants';
import { CodexOAuth } from '../../src/ui/auth/oauth';

vi.mock('../../src/ui/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/request')>();
	return { ...actual, sendRequest: vi.fn() };
});

vi.mock('../../src/ui/streaming-request', () => ({
	sendStreamingRequest: vi.fn(),
}));

vi.mock('../../src/ui/auth/oauth', () => ({
	CodexOAuth: vi.fn(function () {
		return { refreshTokens: vi.fn() };
	}),
}));

const mockSendRequest = vi.mocked(sendRequest);
const mockSendStreamingRequest = vi.mocked(sendStreamingRequest);
const mockCodexOAuth = vi.mocked(CodexOAuth);
const generated = { tags: ['new/tag'] };
const generatedJson = JSON.stringify(generated);
const deadline = Date.now() + 30_000;

function config(name: string): ProviderConfig {
	return {
		name,
		apiKey: 'api-key-secret',
		baseUrl: 'https://provider.example.test/v1/chat/completions',
		models: [],
		auth:
			name === PROVIDER_NAMES.CODEX
				? {
						type: 'oauth',
						oauth: {
							accessToken: 'codex-token-secret',
							refreshToken: 'refresh-token-secret',
							expiresAt: Date.now() / 1000 + 3600,
							accountId: 'account-id',
						},
					}
				: undefined,
	};
}

function chatResponse(content: string): unknown {
	return { choices: [{ finish_reason: 'stop', message: { content, refusal: null } }] };
}

const providerCases: Array<{ name: string; response: unknown; mode: string }> = [
	{ name: PROVIDER_NAMES.OPENAI, response: chatResponse(generatedJson), mode: 'openai' },
	{
		name: PROVIDER_NAMES.ANTHROPIC,
		response: {
			stop_reason: 'tool_use',
			content: [{ type: 'tool_use', name: 'generate_tags', input: generated }],
		},
		mode: 'anthropic',
	},
	{
		name: PROVIDER_NAMES.GEMINI,
		response: {
			candidates: [{ finishReason: 'STOP', content: { parts: [{ text: generatedJson }] } }],
		},
		mode: 'gemini',
	},
	{ name: PROVIDER_NAMES.OPENROUTER, response: chatResponse(generatedJson), mode: 'openai' },
	{ name: PROVIDER_NAMES.DEEPSEEK, response: chatResponse(generatedJson), mode: 'openai' },
	{ name: PROVIDER_NAMES.LMSTUDIO, response: chatResponse(generatedJson), mode: 'openai' },
	{
		name: PROVIDER_NAMES.OLLAMA,
		response: { done: true, done_reason: 'stop', message: { content: generatedJson } },
		mode: 'ollama',
	},
	{ name: PROVIDER_NAMES.CODEX, response: generatedJson, mode: 'codex' },
	{ name: PROVIDER_NAMES.CUSTOM, response: chatResponse(generatedJson), mode: 'openai' },
];

describe('UnifiedProvider generated-tags contract', () => {
	const provider = new UnifiedProvider();

	beforeEach(() => vi.clearAllMocks());

	it('requires completed chat output while accepting an explicit null refusal', () => {
		expect(provider.processApiResponse(chatResponse(generatedJson), PROVIDER_NAMES.OPENAI)).toEqual(
			generated
		);
		for (const finish_reason of [undefined, 'length', 'content_filter']) {
			expect(() =>
				provider.processApiResponse(
					{
						choices: [{ finish_reason, message: { content: generatedJson, refusal: null } }],
					},
					PROVIDER_NAMES.OPENAI
				)
			).toThrow();
		}
	});

	it('requires one named completed Anthropic tool result', () => {
		for (const [stop_reason, name] of [
			['max_tokens', 'generate_tags'],
			['tool_use', 'unrequested_tool'],
			[undefined, 'generate_tags'],
		]) {
			expect(() =>
				provider.processApiResponse(
					{
						stop_reason,
						content: [{ type: 'tool_use', name, input: generated }],
					},
					PROVIDER_NAMES.ANTHROPIC
				)
			).toThrow();
		}
	});

	it('parses Gemini answer text separately from optional reasoning parts', () => {
		expect(
			provider.processApiResponse(
				{
					candidates: [
						{
							finishReason: 'STOP',
							content: {
								parts: [
									{ thought: true, text: 'Synthetic reasoning, not output' },
									{ text: '{\"tags\":' },
									{ text: '[\"new/tag\"]}' },
								],
							},
						},
					],
				},
				PROVIDER_NAMES.GEMINI
			)
		).toEqual(generated);
	});

	it('rejects truncated Ollama responses even when buffered JSON happens to parse', () => {
		expect(() =>
			provider.processApiResponse(
				{
					done: true,
					done_reason: 'length',
					message: { content: generatedJson },
				},
				PROVIDER_NAMES.OLLAMA
			)
		).toThrow();
	});

	it.each(providerCases)(
		'$name returns strict generated tags with its native schema placement',
		async ({ name, response, mode }) => {
			const providerConfig = config(name);
			if (name === PROVIDER_NAMES.CODEX) {
				mockSendStreamingRequest.mockResolvedValueOnce(response as string);
			} else {
				mockSendRequest.mockResolvedValueOnce(response);
			}

			await expect(
				provider.callAPI(
					'tag system',
					'tag prompt',
					providerConfig,
					'model',
					undefined,
					undefined,
					{ deadline }
				)
			).resolves.toEqual(generated);

			const call =
				name === PROVIDER_NAMES.CODEX
					? mockSendStreamingRequest.mock.calls[0]
					: mockSendRequest.mock.calls[0];
			const requestBody = call?.[2] as Record<string, unknown>;
			if (mode === 'openai') {
				const responseFormat = requestBody.response_format as Record<string, unknown>;
				const schemaConfig = responseFormat.json_schema as Record<string, unknown>;
				expect(schemaConfig).toMatchObject({ strict: true, schema: TAG_GENERATION_SCHEMA });
			} else if (mode === 'anthropic') {
				const tools = requestBody.tools as Array<Record<string, unknown>>;
				expect(tools[0].input_schema).toEqual(TAG_GENERATION_SCHEMA);
			} else if (mode === 'gemini') {
				const generationConfig = requestBody.generationConfig as Record<string, unknown>;
				expect(generationConfig.responseSchema).toEqual(TAG_GENERATION_SCHEMA);
			} else if (mode === 'ollama') {
				expect(requestBody.format).toEqual(TAG_GENERATION_SCHEMA);
			} else {
				const text = requestBody.text as Record<string, unknown>;
				expect(text.format).toMatchObject({
					type: 'json_schema',
					strict: true,
					schema: TAG_GENERATION_SCHEMA,
				});
				expect(mockSendStreamingRequest.mock.calls[0]?.[4]).toEqual({ deadline });
			}
			if (name !== PROVIDER_NAMES.CODEX) {
				expect(mockSendRequest.mock.calls[0]?.[3]).toEqual({ deadline });
			}
		}
	);

	it('keeps official provider headers and endpoints', async () => {
		mockSendRequest.mockResolvedValueOnce({
			stop_reason: 'tool_use',
			content: [{ type: 'tool_use', name: 'generate_tags', input: generated }],
		});
		const anthropic = config(PROVIDER_NAMES.ANTHROPIC);
		await provider.callAPI('sys', 'prompt', anthropic, 'claude');
		expect(mockSendRequest.mock.calls[0]?.[0]).toBe(anthropic.baseUrl);
		expect(mockSendRequest.mock.calls[0]?.[1]).toMatchObject({
			'x-api-key': 'api-key-secret',
			'anthropic-version': '2023-06-01',
		});

		mockSendRequest.mockResolvedValueOnce({
			candidates: [{ finishReason: 'STOP', content: { parts: [{ text: generatedJson }] } }],
		});
		await provider.callAPI('sys', 'prompt', config(PROVIDER_NAMES.GEMINI), 'gemini-pro');
		expect(mockSendRequest.mock.calls[1]?.[0]).toBe(
			'https://provider.example.test/v1/chat/completions/models/gemini-pro:generateContent?key=api-key-secret'
		);
		expect(mockSendRequest.mock.calls[1]?.[1]).toEqual({ 'Content-Type': 'application/json' });
	});

	it('rejects unknown names instead of falling back to OpenAI-compatible parsing', async () => {
		await expect(
			provider.callAPI('system', 'prompt', config('Unsupported secret name'), 'model')
		).rejects.toThrow('Unsupported provider');
		expect(mockSendRequest).not.toHaveBeenCalled();
	});

	it('rejects legacy schemas and extra fields without echoing response data', () => {
		for (const content of [
			'{"output":["old"],"reliability":0.9}',
			'{"tags":["new"],"secret":"response-secret"}',
			'{ malformed response-secret',
		]) {
			let thrown: unknown;
			try {
				provider.processApiResponse(chatResponse(content));
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(Error);
			expect((thrown as Error).message).not.toContain('response-secret');
			expect((thrown as Error).message).not.toContain(content);
		}
	});

	it('rejects refusal and incomplete provider results without exposing response data', () => {
		const cases: Array<[unknown, string?]> = [
			[
				{ choices: [{ message: { refusal: 'private refusal', content: null } }] },
				PROVIDER_NAMES.OPENAI,
			],
			[{ content: [{ type: 'refusal', refusal: 'private refusal' }] }, PROVIDER_NAMES.ANTHROPIC],
			[
				{ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: generatedJson }] } }] },
				PROVIDER_NAMES.GEMINI,
			],
			[{ done: false, message: { content: generatedJson } }, PROVIDER_NAMES.OLLAMA],
			[
				{
					status: 'completed',
					output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] }],
				},
				PROVIDER_NAMES.CODEX,
			],
		];
		for (const [response, name] of cases) {
			let thrown: unknown;
			try {
				provider.processApiResponse(response, name);
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(Error);
			expect((thrown as Error).message).not.toContain('private refusal');
		}
	});

	it('accepts only Codex completed terminal events and rejects failed, incomplete, and refusal events', async () => {
		mockSendStreamingRequest.mockResolvedValueOnce(generatedJson);
		await provider.callAPI('system', 'prompt', config(PROVIDER_NAMES.CODEX), 'model');
		const parseEvent = mockSendStreamingRequest.mock.calls[0]?.[3];
		expect(parseEvent).toBeDefined();
		expect(
			parseEvent?.({ type: 'response.completed', response: { status: 'completed', output: [] } })
		).toEqual({ type: 'complete' });
		for (const event of [
			{ type: 'response.failed' },
			{ type: 'response.incomplete' },
			{ type: 'response.refusal.delta' },
			{
				type: 'response.completed',
				response: {
					status: 'completed',
					output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'response-secret' }] }],
				},
			},
		]) {
			expect(parseEvent?.(event)).toEqual({ type: 'error' });
		}
	});

	it('preserves HttpError identity and shares deadline through awaited Codex refresh', async () => {
		const unauthorized = new HttpError('HTTP_ERROR', 401);
		let refreshCallbackCompleted = false;
		mockSendStreamingRequest.mockRejectedValueOnce(unauthorized);
		mockSendStreamingRequest.mockImplementationOnce(async () => {
			expect(refreshCallbackCompleted).toBe(true);
			return generatedJson;
		});
		const tokens = {
			accessToken: 'new-codex-token',
			refreshToken: 'new-refresh-token',
			expiresAt: Date.now() / 1000 + 7200,
			accountId: 'account-id',
		};
		const refreshTokens = vi.fn().mockResolvedValue(tokens);
		mockCodexOAuth.mockImplementation(function () {
			return { refreshTokens } as unknown as CodexOAuth;
		});
		const onTokenRefresh = vi.fn(async () => {
			await Promise.resolve();
			refreshCallbackCompleted = true;
		});

		await expect(
			provider.callAPI(
				'system',
				'prompt',
				config(PROVIDER_NAMES.CODEX),
				'model',
				undefined,
				onTokenRefresh,
				{ deadline }
			)
		).resolves.toEqual(generated);
		expect(mockSendStreamingRequest).toHaveBeenCalledTimes(2);
		expect(mockSendStreamingRequest.mock.calls[0]?.[4]).toEqual({ deadline });
		expect(mockSendStreamingRequest.mock.calls[1]?.[4]).toEqual({ deadline });
		expect(mockSendStreamingRequest.mock.calls[1]?.[1]).toMatchObject({
			Authorization: 'Bearer new-codex-token',
			'ChatGPT-Account-Id': 'account-id',
		});
		expect(onTokenRefresh).toHaveBeenCalledWith(tokens);
		expect(CODEX_OAUTH.API_ENDPOINT).toBe(mockSendStreamingRequest.mock.calls[0]?.[0]);
	});

	it('does not replace a safe non-401 transport error', async () => {
		const error = new HttpError('TRANSPORT_ERROR');
		mockSendRequest.mockRejectedValueOnce(error);

		await expect(
			provider.callAPI('system', 'prompt', config(PROVIDER_NAMES.OPENAI), 'model')
		).rejects.toBe(error);
		expect(mockSendStreamingRequest).not.toHaveBeenCalled();
	});
});
