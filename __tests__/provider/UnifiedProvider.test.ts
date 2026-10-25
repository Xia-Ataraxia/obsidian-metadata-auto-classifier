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
		baseUrl:
			name === PROVIDER_NAMES.GEMINI
				? 'https://generativelanguage.googleapis.com/v1beta'
				: 'https://provider.example.test/v1/chat/completions',
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
	{ name: PROVIDER_NAMES.OPENROUTER, response: chatResponse(generatedJson), mode: 'openrouter' },
	{ name: PROVIDER_NAMES.DEEPSEEK, response: chatResponse(generatedJson), mode: 'deepseek' },
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

	it('requires completed chat output while accepting null or absent refusal', () => {
		expect(provider.processApiResponse(chatResponse(generatedJson), PROVIDER_NAMES.OPENAI)).toEqual(
			generated
		);
		expect(
			provider.processApiResponse(
				{
					choices: [{ finish_reason: 'stop', message: { content: generatedJson } }],
				},
				PROVIDER_NAMES.OPENAI
			)
		).toEqual(generated);
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
		for (const input of [{ tags: ['new/tag'], extra: true }, { tags: [1] }]) {
			expect(() =>
				provider.processApiResponse(
					{
						stop_reason: 'tool_use',
						content: [{ type: 'tool_use', name: 'generate_tags', input }],
					},
					PROVIDER_NAMES.ANTHROPIC
				)
			).toThrow();
		}
		expect(() =>
			provider.processApiResponse(
				{
					stop_reason: 'tool_use',
					content: [
						{ type: 'tool_use', name: 'generate_tags', input: generated },
						{ type: 'tool_use', name: 'generate_tags', input: generated },
					],
				},
				PROVIDER_NAMES.ANTHROPIC
			)
		).toThrow();
	});

	it('keeps DeepSeek JSON mode strict at the local acceptance boundary', () => {
		expect(
			provider.processApiResponse(chatResponse(generatedJson), PROVIDER_NAMES.DEEPSEEK)
		).toEqual(generated);
		for (const content of ['', '{"tags":["new/tag"],"extra":true}', '{"tags":[1]}', '{"tags":']) {
			expect(() =>
				provider.processApiResponse(chatResponse(content), PROVIDER_NAMES.DEEPSEEK)
			).toThrow();
		}
		expect(() =>
			provider.processApiResponse(
				{
					choices: [{ finish_reason: 'length', message: { content: generatedJson } }],
				},
				PROVIDER_NAMES.DEEPSEEK
			)
		).toThrow();
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
			if (name === PROVIDER_NAMES.OLLAMA) providerConfig.temperature = 0.23;
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
			if (mode === 'openai' || mode === 'openrouter') {
				const responseFormat = requestBody.response_format as Record<string, unknown>;
				const schemaConfig = responseFormat.json_schema as Record<string, unknown>;
				expect(schemaConfig).toMatchObject({ strict: true, schema: TAG_GENERATION_SCHEMA });
				if (mode === 'openrouter') {
					expect(requestBody.provider).toEqual({ require_parameters: true });
				}
			} else if (mode === 'deepseek') {
				expect(requestBody.response_format).toEqual({ type: 'json_object' });
				expect(requestBody.messages).toEqual([
					{
						role: 'system',
						content:
							'tag system\n\nReturn only JSON with exactly one property named "tags", whose value is an array of strings. Example: {"tags": ["tag1"]}.',
					},
					{ role: 'user', content: 'tag prompt' },
				]);
			} else if (mode === 'anthropic') {
				const tools = requestBody.tools as Array<Record<string, unknown>>;
				expect(tools).toHaveLength(1);
				expect(tools[0]).toMatchObject({ input_schema: TAG_GENERATION_SCHEMA, strict: true });
				expect(requestBody.tool_choice).toEqual({
					type: 'tool',
					name: 'generate_tags',
					disable_parallel_tool_use: true,
				});
			} else if (mode === 'gemini') {
				const generationConfig = requestBody.generationConfig as Record<string, unknown>;
				expect(generationConfig.responseMimeType).toBe('application/json');
				expect(generationConfig.responseJsonSchema).toEqual(TAG_GENERATION_SCHEMA);
				expect(generationConfig.responseSchema).toBeUndefined();
				expect(
					(generationConfig.responseJsonSchema as Record<string, unknown>).additionalProperties
				).toBe(false);
			} else if (mode === 'ollama') {
				expect(requestBody.format).toEqual(TAG_GENERATION_SCHEMA);
				expect(requestBody.options).toEqual({ temperature: 0.23 });
				expect(requestBody).not.toHaveProperty('temperature');
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
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=api-key-secret'
		);
		expect(mockSendRequest.mock.calls[1]?.[1]).toEqual({ 'Content-Type': 'application/json' });
	});

	it('does not retry OpenRouter when an endpoint rejects required parameters', async () => {
		const unsupportedEndpoint = new HttpError('HTTP_ERROR', 404);
		mockSendRequest.mockRejectedValueOnce(unsupportedEndpoint);

		await expect(
			provider.callAPI('system', 'prompt', config(PROVIDER_NAMES.OPENROUTER), 'model')
		).rejects.toBe(unsupportedEndpoint);
		expect(mockSendRequest).toHaveBeenCalledTimes(1);
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
				{
					choices: [
						{
							finish_reason: 'stop',
							message: { refusal: 'private refusal', content: generatedJson },
						},
					],
				},
				PROVIDER_NAMES.OPENAI,
			],
			[
				{
					stop_reason: 'tool_use',
					content: [
						{ type: 'refusal', refusal: 'private refusal' },
						{ type: 'tool_use', name: 'generate_tags', input: generated },
					],
				},
				PROVIDER_NAMES.ANTHROPIC,
			],
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
		const requestOptions = { deadline, assertCurrent: vi.fn() };
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
				requestOptions
			)
		).resolves.toEqual(generated);
		expect(mockSendStreamingRequest).toHaveBeenCalledTimes(2);
		expect(mockSendStreamingRequest.mock.calls[0]?.[4]).toEqual(requestOptions);
		expect(mockSendStreamingRequest.mock.calls[1]?.[4]).toEqual(requestOptions);
		expect(refreshTokens).toHaveBeenCalledWith('refresh-token-secret', requestOptions);
		expect(mockSendStreamingRequest.mock.calls[1]?.[1]).toMatchObject({
			Authorization: 'Bearer new-codex-token',
			'ChatGPT-Account-Id': 'account-id',
		});
		expect(onTokenRefresh).toHaveBeenCalledWith(tokens);
		expect(CODEX_OAUTH.API_ENDPOINT).toBe(mockSendStreamingRequest.mock.calls[0]?.[0]);
	});

	it('serializes refreshes across instances and holds ownership through token persistence', async () => {
		mockSendStreamingRequest
			.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401))
			.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401))
			.mockResolvedValueOnce(generatedJson);
		const tokens = {
			accessToken: 'rotated-access-token',
			refreshToken: 'rotated-refresh-token',
			expiresAt: Date.now() / 1000 + 7200,
			accountId: 'account-id',
		};
		const refreshTokens = vi.fn().mockResolvedValue(tokens);
		mockCodexOAuth.mockImplementation(function () {
			return { refreshTokens } as unknown as CodexOAuth;
		});
		let releasePersistence!: () => void;
		let markPersistenceStarted!: () => void;
		const persistenceStarted = new Promise<void>((resolve) => {
			markPersistenceStarted = resolve;
		});
		const persist = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releasePersistence = resolve;
					markPersistenceStarted();
				})
		);
		const firstCall = new UnifiedProvider().callAPI(
			'system',
			'prompt',
			config(PROVIDER_NAMES.CODEX),
			'model',
			undefined,
			persist
		);

		try {
			await persistenceStarted;
			const competingError = await new UnifiedProvider()
				.callAPI('system', 'prompt', config(PROVIDER_NAMES.CODEX), 'model', undefined, vi.fn())
				.then(
					() => new Error('Unexpected competing refresh success'),
					(error: unknown) => error
				);
			expect(competingError).toBeInstanceOf(Error);
			expect((competingError as Error).message).toBe('Codex token refresh is already in progress');
			expect((competingError as Error).message).not.toContain('refresh-token-secret');
			expect(refreshTokens).toHaveBeenCalledTimes(1);
			expect(mockSendStreamingRequest).toHaveBeenCalledTimes(2);

			releasePersistence();
			await expect(firstCall).resolves.toEqual(generated);
			expect(mockSendStreamingRequest).toHaveBeenCalledTimes(3);
		} finally {
			releasePersistence?.();
			await firstCall.catch(() => undefined);
		}
	});

	it.each(['refresh', 'persistence'] as const)(
		'releases refresh ownership after %s failure without retrying the failed operation',
		async (failure) => {
			mockSendStreamingRequest
				.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401))
				.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401))
				.mockResolvedValueOnce(generatedJson);
			const tokens = {
				accessToken: 'rotated-access-token',
				refreshToken: 'rotated-refresh-token',
				expiresAt: Date.now() / 1000 + 7200,
				accountId: 'account-id',
			};
			const refreshTokens = vi.fn().mockResolvedValue(tokens);
			if (failure === 'refresh') {
				refreshTokens.mockRejectedValueOnce(new Error('synthetic refresh failure'));
			}
			mockCodexOAuth.mockImplementation(function () {
				return { refreshTokens } as unknown as CodexOAuth;
			});
			const persist = vi.fn().mockResolvedValue(undefined);
			if (failure === 'persistence') {
				persist.mockRejectedValueOnce(new Error('synthetic persistence failure'));
			}

			const firstError = await new UnifiedProvider()
				.callAPI('system', 'prompt', config(PROVIDER_NAMES.CODEX), 'model', undefined, persist)
				.then(
					() => new Error('Unexpected failed refresh success'),
					(error: unknown) => error
				);
			expect(firstError).toBeInstanceOf(Error);
			expect((firstError as Error).message).not.toContain('refresh-token-secret');
			expect(refreshTokens).toHaveBeenCalledTimes(1);
			expect(mockSendStreamingRequest).toHaveBeenCalledTimes(1);

			await expect(
				new UnifiedProvider().callAPI(
					'system',
					'prompt',
					config(PROVIDER_NAMES.CODEX),
					'model',
					undefined,
					vi.fn()
				)
			).resolves.toEqual(generated);
			expect(refreshTokens).toHaveBeenCalledTimes(2);
			expect(mockSendStreamingRequest).toHaveBeenCalledTimes(3);
		}
	);

	it('does not use legacy Codex OAuth when explicit API-key auth is selected', async () => {
		const providerConfig = config(PROVIDER_NAMES.CODEX);
		providerConfig.oauth =
			providerConfig.auth?.type === 'oauth' ? providerConfig.auth.oauth : undefined;
		providerConfig.auth = { type: 'apiKey', apiKey: 'api-key-secret' };

		await expect(
			provider.callAPI('system', 'prompt', providerConfig, 'model', undefined, vi.fn())
		).rejects.toThrow('Provider authentication mode is unsupported');
		expect(mockSendStreamingRequest).not.toHaveBeenCalled();
		expect(mockCodexOAuth).not.toHaveBeenCalled();
	});

	it('does not rotate credentials without a persistence callback', async () => {
		mockSendStreamingRequest.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401));
		await expect(
			provider.callAPI('system', 'prompt', config(PROVIDER_NAMES.CODEX), 'model')
		).rejects.toThrow('Codex token persistence is unavailable');
		expect(mockCodexOAuth).not.toHaveBeenCalled();
		expect(mockSendStreamingRequest).toHaveBeenCalledTimes(1);
	});

	it('does not persist or retry with a different refreshed account', async () => {
		mockSendStreamingRequest.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401));
		const refreshed = {
			accessToken: 'new-token',
			refreshToken: 'new-refresh',
			expiresAt: Date.now() / 1000 + 3600,
			accountId: 'different-account',
		};
		mockCodexOAuth.mockImplementationOnce(function () {
			return { refreshTokens: vi.fn().mockResolvedValue(refreshed) } as unknown as CodexOAuth;
		});
		const persist = vi.fn();
		await expect(
			provider.callAPI(
				'system',
				'prompt',
				config(PROVIDER_NAMES.CODEX),
				'model',
				undefined,
				persist
			)
		).rejects.toThrow('Codex account changed during refresh');
		expect(persist).not.toHaveBeenCalled();
		expect(mockSendStreamingRequest).toHaveBeenCalledTimes(1);
	});

	it('keeps the shared timeout when refresh fails after expiry', async () => {
		mockSendStreamingRequest.mockRejectedValueOnce(new HttpError('HTTP_ERROR', 401));
		const clock = vi.spyOn(Date, 'now');
		mockCodexOAuth.mockImplementationOnce(function () {
			return {
				refreshTokens: vi.fn(async () => {
					clock.mockReturnValue(deadline);
					throw new Error('synthetic-private-refresh-error');
				}),
			} as unknown as CodexOAuth;
		});
		const persist = vi.fn();
		try {
			await expect(
				provider.callAPI(
					'system',
					'prompt',
					config(PROVIDER_NAMES.CODEX),
					'model',
					undefined,
					persist,
					{ deadline }
				)
			).rejects.toMatchObject({ code: 'TIMEOUT' });
			expect(persist).not.toHaveBeenCalled();
			expect(mockSendStreamingRequest).toHaveBeenCalledTimes(1);
		} finally {
			clock.mockRestore();
		}
	});

	it('does not use stored API keys when OAuth is explicitly selected for an API-key provider', async () => {
		const configured = config(PROVIDER_NAMES.OPENAI);
		configured.auth = config(PROVIDER_NAMES.CODEX).auth;
		await expect(provider.callAPI('system', 'prompt', configured, 'model')).rejects.toThrow(
			'Provider authentication mode is unsupported'
		);
		expect(mockSendRequest).not.toHaveBeenCalled();
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
