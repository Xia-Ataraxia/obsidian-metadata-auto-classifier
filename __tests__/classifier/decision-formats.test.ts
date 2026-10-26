import {
	decisionEndpoint,
	decisionTransport,
	toOpenAIDecisionsRequest,
} from '../../src/domain/decision-formats';
import { decodeOpenAIDecisionsResponse } from '../../src/domain/decision-selection';
import { classificationTarget, generationTarget } from '../../src/domain/model-list';
import type { AutoClassifierSettings, ProviderConfig } from '../../src/types';

const ids = ['candidate_0000', 'candidate_0001'];

describe('decisionTransport', () => {
	test.each([
		['TypeSafe', {}, 'systemone'],
		['OpenAI', { decision: true }, 'openai-decisions'],
		['OpenAI', {}, undefined],
		['OpenRouter', { decision: true }, 'systemone'],
		['Custom', { decision: true }, 'systemone'],
		['Anthropic', {}, undefined],
		['Codex', { decision: true }, undefined],
	] as const)('%s %j uses %s', (provider, model, transport) => {
		expect(decisionTransport(provider, model)).toBe(transport);
	});
});

describe('decisionEndpoint', () => {
	test.each([
		['https://api.openai.com/v1', 'openai-decisions', 'https://api.openai.com/v1/decisions'],
		[
			'https://openrouter.ai/api/v1/chat/completions',
			'systemone',
			'https://openrouter.ai/api/v1/systemone',
		],
		['https://api.typesafe.ai/v1/systemone/ ', 'systemone', 'https://api.typesafe.ai/v1/systemone'],
	] as const)('%s → %s', (baseUrl, transport, expected) => {
		expect(decisionEndpoint(baseUrl, transport)).toBe(expected);
	});
});

test('maps typed questions to OpenAI predicates', () => {
	const request = {
		model: 'gpt-6-luna',
		state: { body: 'b', fieldName: 'tags', instructions: '' },
		questions: { candidate_0000: { type: 'noul' as const, instructions: 'fits?' } },
	};
	expect(toOpenAIDecisionsRequest(request)).toEqual({
		model: 'gpt-6-luna',
		input: 'State (JSON):\n{"body":"b","fieldName":"tags","instructions":""}',
		questions: [{ type: 'predicate', name: 'candidate_0000', instructions: 'fits?' }],
	});
});

describe('decodeOpenAIDecisionsResponse', () => {
	test('reads predicates by name and treats refusal as uncertain', () => {
		const result = decodeOpenAIDecisionsResponse(
			{
				answers: [
					{ type: 'refusal', name: 'candidate_0001' },
					{ type: 'predicate', name: 'candidate_0000', probability: 0.9 },
				],
			},
			ids
		);
		expect(result).toEqual({
			ok: true,
			probabilities: Object.assign(Object.create(null), { candidate_0000: 0.9, candidate_0001: 0.5 }),
		});
	});

	test.each([
		['not a list', { answers: {} }, 'invalid-response'],
		[
			'duplicate name',
			{
				answers: [
					{ type: 'predicate', name: 'candidate_0000', probability: 0.1 },
					{ type: 'predicate', name: 'candidate_0000', probability: 0.9 },
				],
			},
			'answer-set-mismatch',
		],
		[
			'missing answer',
			{ answers: [{ type: 'predicate', name: 'candidate_0000', probability: 0.1 }] },
			'answer-set-mismatch',
		],
		[
			'out of range',
			{
				answers: [
					{ type: 'predicate', name: 'candidate_0000', probability: 2 },
					{ type: 'predicate', name: 'candidate_0001', probability: 0 },
				],
			},
			'invalid-answer',
		],
	] as const)('rejects %s', (_label, response, code) => {
		expect(decodeOpenAIDecisionsResponse(response, ids)).toEqual({ ok: false, error: { code } });
	});
});

describe('model targets', () => {
	const typesafe: ProviderConfig = {
		name: 'TypeSafe',
		baseUrl: 'https://api.typesafe.ai/v1/systemone',
		models: [{ id: 'jev-1.14.0', name: 'Jev', decision: true }],
		auth: { type: 'apiKey', apiKey: 'k' },
	};
	const anthropic: ProviderConfig = {
		name: 'Anthropic',
		baseUrl: 'https://api.anthropic.com/v1/messages',
		models: [{ id: 'claude', name: 'Claude' }],
		auth: { type: 'apiKey', apiKey: 'k' },
	};
	const settings = (selectedProvider: string, selectedModel: string, providers = [typesafe, anthropic]) =>
		({ providers, selectedProvider, selectedModel }) as AutoClassifierSettings;

	test('a selected chat model generates tags but never classifies', () => {
		const s = settings('Anthropic', 'claude');
		expect(generationTarget(s)?.model.id).toBe('claude');
		expect(classificationTarget(s)?.model.id).toBe('jev-1.14.0');
		expect(classificationTarget(settings('Anthropic', 'claude', [anthropic]))).toBeUndefined();
	});

	test('generation falls back to the first authenticated chat model when a decision model is selected', () => {
		const s = settings('TypeSafe', 'jev-1.14.0');
		expect(classificationTarget(s)?.model.id).toBe('jev-1.14.0');
		expect(generationTarget(s)?.provider.name).toBe('Anthropic');
		expect(generationTarget(settings('TypeSafe', 'jev-1.14.0', [typesafe]))).toBeUndefined();
	});

	test('a missing selection falls back to the first authenticated decision model', () => {
		expect(classificationTarget(settings('TypeSafe', 'gone'))?.model.id).toBe('jev-1.14.0');
		expect(classificationTarget(settings('TypeSafe', 'gone', [anthropic]))).toBeUndefined();
	});
});
