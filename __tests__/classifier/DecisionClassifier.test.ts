import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionClassificationError, DecisionClassifier } from '../../src/ui/DecisionClassifier';
import { sendRequest } from '../../src/ui/request';
import type { Model, ProviderConfig } from '../../src/types';

vi.mock('../../src/ui/request', () => ({ sendRequest: vi.fn() }));
const request = vi.mocked(sendRequest);
const config = { apiKey: 'synthetic-key', model: 'jev-1.14.0' };
const provider: ProviderConfig = {
	name: 'TypeSafe',
	baseUrl: 'https://api.typesafe.ai/v1/systemone',
	models: [{ id: config.model, name: 'Jev', decision: true }],
	auth: { type: 'apiKey', apiKey: config.apiKey },
};
const model: Model = { id: config.model, name: 'Jev', decision: true };
const input = {
	body: 'Synthetic document',
	fieldName: 'topics',
	instructions: 'Keep exact meaning',
	candidates: ['first', 'second'],
	max: 2,
};
const control = () => ({ deadline: Date.now() + 60_000, assertCurrent: vi.fn() });
function answer(payload: string | object, probability = 0.8) {
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload) ||
		!('model' in payload) ||
		typeof payload.model !== 'string' ||
		!('questions' in payload) ||
		typeof payload.questions !== 'object' ||
		payload.questions === null ||
		Array.isArray(payload.questions)
	) {
		throw new Error('Expected a structured decision request');
	}
	return {
		model: payload.model,
		answers: Object.fromEntries(
			Object.keys(payload.questions).map((id) => [id, { type: 'noul', noul: probability }])
		),
		usage: { input_tokens: 12, output_tokens: 2 },
	};
}

beforeEach(() => vi.resetAllMocks());

describe('DecisionClassifier', () => {
	it('sends the official typed request with shared deadline and original values', async () => {
		request.mockImplementation(async (_url, _headers, payload) => answer(payload));
		const operation = control();
		const result = await new DecisionClassifier().classify(input, provider, model, operation);
		expect(result).toEqual({ status: 'selected', values: ['first', 'second'] });
		expect(request).toHaveBeenCalledWith(
			'https://api.typesafe.ai/v1/systemone',
			{ Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json' },
			expect.objectContaining({
				model: config.model,
				state: {
					body: input.body,
					fieldName: input.fieldName,
					instructions: input.instructions,
				},
			}),
			{ deadline: operation.deadline, assertCurrent: expect.any(Function) }
		);
		expect(operation.assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it('does not require authentication or send empty questions without candidates', async () => {
		const result = await new DecisionClassifier().classify(
			{ ...input, candidates: ['', '  '] },
			{ ...provider, auth: { type: 'apiKey', apiKey: '' } },
			model,
			control()
		);
		expect(result).toEqual({ status: 'no-candidates' });
		expect(request).not.toHaveBeenCalled();
	});

	it('rejects expired work before making any request', async () => {
		await expect(
			new DecisionClassifier().classify(input, provider, model, {
				deadline: Date.now(),
				assertCurrent: vi.fn(),
			})
		).rejects.toMatchObject({ code: 'expired' });
		expect(request).not.toHaveBeenCalled();
	});

	it('discards an answer when the live operation is revoked during inference', async () => {
		let current = true;
		request.mockImplementation(async (_url, _headers, payload) => {
			current = false;
			return answer(payload);
		});
		await expect(
			new DecisionClassifier().classify(input, provider, model, {
				deadline: Date.now() + 60_000,
				assertCurrent: () => {
					if (!current) throw new Error('Synthetic conflict');
				},
			})
		).rejects.toThrow('Synthetic conflict');
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('fails the whole selection when a later chunk has an invalid answer', async () => {
		const candidates = Array.from({ length: 100 }, (_, index) => `${index}-${'x'.repeat(1000)}`);
		request.mockImplementationOnce(async (_url, _headers, payload) => answer(payload));
		request.mockResolvedValueOnce({ model: config.model, answers: {}, usage: {} });
		await expect(
			new DecisionClassifier().classify({ ...input, candidates }, provider, model, control())
		).rejects.toMatchObject({ code: 'answer-set-mismatch' });
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('never exposes rejected response data in its safe error', async () => {
		request.mockResolvedValueOnce({ model: 'synthetic-response-secret', answers: {} });
		let caught: unknown;
		try {
			await new DecisionClassifier().classify(input, provider, model, control());
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DecisionClassificationError);
		expect(String(caught)).not.toContain('synthetic-response-secret');
		expect(String(caught)).not.toContain(config.apiKey);
	});

	it('sends OpenAI Decisions predicates for an OpenAI decision model', async () => {
		request.mockImplementation(async (_url, _headers, payload) => ({
			answers: (payload as { questions: Array<{ name: string }> }).questions.map(({ name }) => ({
				type: 'predicate',
				name,
				probability: name === 'candidate_0000' ? 0.9 : 0.1,
			})),
		}));
		const openai: ProviderConfig = {
			name: 'OpenAI',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			models: [{ id: 'gpt-6-luna', name: 'Luna', decision: true }],
			auth: { type: 'apiKey', apiKey: config.apiKey },
		};
		const result = await new DecisionClassifier().classify(
			input,
			openai,
			{ id: 'gpt-6-luna', name: 'Luna', decision: true },
			control()
		);
		expect(result).toEqual({ status: 'selected', values: ['first'] });
		expect(request).toHaveBeenCalledWith(
			'https://api.openai.com/v1/decisions',
			expect.objectContaining({ Authorization: 'Bearer synthetic-key' }),
			expect.objectContaining({
				model: 'gpt-6-luna',
				questions: [
					expect.objectContaining({ type: 'predicate', name: 'candidate_0000' }),
					expect.objectContaining({ type: 'predicate', name: 'candidate_0001' }),
				],
			}),
			expect.anything()
		);
	});

	it('refuses chat models instead of emulating decisions', async () => {
		const anthropic: ProviderConfig = {
			name: 'Anthropic',
			baseUrl: 'https://api.anthropic.com/v1/messages',
			models: [{ id: 'claude', name: 'Claude' }],
			auth: { type: 'apiKey', apiKey: config.apiKey },
		};
		await expect(
			new DecisionClassifier().classify(input, anthropic, { id: 'claude', name: 'Claude' }, control())
		).rejects.toMatchObject({ code: 'not-a-decision-model' });
		expect(request).not.toHaveBeenCalled();
	});
});
