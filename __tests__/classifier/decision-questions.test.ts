import { buildDecisionRequests } from '../../src/domain/decision-questions';
import { decodeSystemOneResponse } from '../../src/domain/decision-selection';
import type { DecisionRequestChunk } from '../../src/types/decision';

function validResponse(
	answers: Record<string, unknown> = { candidate_0000: { type: 'noul', noul: 0.8 } }
) {
	return {
		model: 'jev-1.14.0',
		answers,
		usage: { input_tokens: 10, output_tokens: 2 },
	};
}

describe('buildDecisionRequests', () => {
	test('keeps body, field, and guidance verbatim in state while candidate text appears in Noul instructions', () => {
		const body = '본문\r\nbody bytes';
		const instructions = '  prefer 계층형 값\nkeep this exactly  ';
		const candidate = 'Work/Projects/日本語';
		const result = buildDecisionRequests({
			model: 'jev-1.14.0',
			body,
			fieldName: '분류',
			instructions,
			candidates: [candidate],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.chunks).toHaveLength(1);
		const chunk = result.chunks[0] as DecisionRequestChunk;
		expect(chunk.request).toEqual({
			model: 'jev-1.14.0',
			state: { body, fieldName: '분류', instructions },
			questions: {
				candidate_0000: expect.objectContaining({ type: 'noul' }),
			},
		});
		expect(chunk.request.state.body).toBe(body);
		expect(chunk.request.state.fieldName).toBe('분류');
		expect(chunk.request.state.instructions).toBe(instructions);
		expect(Object.keys(chunk.request.state)).toEqual(['body', 'fieldName', 'instructions']);
		expect(JSON.stringify(chunk.request.state)).toBe(
			JSON.stringify({ body, fieldName: '분류', instructions })
		);
		expect(chunk.request.questions.candidate_0000?.instructions).not.toContain(instructions);
		expect(chunk.request.questions.candidate_0000?.instructions).toContain(candidate);
		expect(chunk.candidates).toEqual([{ id: 'candidate_0000', value: candidate, index: 0 }]);
	});

	test('removes blank-only and exact duplicates while preserving nonblank bytes, case, hierarchy, and original indexes', () => {
		const result = buildDecisionRequests({
			model: 'jev-1.14.0',
			body: 'body',
			fieldName: 'tags',
			instructions: '',
			candidates: [
				'',
				' \t',
				'__proto__',
				'Work/Note',
				'work/Note',
				'__proto__',
				' \n',
				' Work/Note ',
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const chunk = result.chunks[0] as DecisionRequestChunk;
		expect(chunk.candidates).toEqual([
			{ id: 'candidate_0000', value: '__proto__', index: 2 },
			{ id: 'candidate_0001', value: 'Work/Note', index: 3 },
			{ id: 'candidate_0002', value: 'work/Note', index: 4 },
			{ id: 'candidate_0003', value: ' Work/Note ', index: 7 },
		]);
		expect(Object.keys(chunk.request.questions)).toEqual([
			'candidate_0000',
			'candidate_0001',
			'candidate_0002',
			'candidate_0003',
		]);
		expect(Object.getPrototypeOf(chunk.request.questions)).toBeNull();
		expect(chunk.request.questions.candidate_0000?.instructions).toContain('__proto__');
		expect(chunk.request.questions.candidate_0003?.instructions).toContain(' Work/Note ');
	});

	test('packs candidates in stable order into repeatable request-sized chunks', () => {
		const candidates = ['a'.repeat(18_000), 'b'.repeat(18_000), 'c'.repeat(18_000)];
		const input = {
			model: 'jev-1.14.0',
			body: 'body',
			fieldName: 'tags',
			instructions: '',
			candidates,
		};
		const first = buildDecisionRequests(input);
		const second = buildDecisionRequests(input);
		expect(first).toEqual(second);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.chunks.map((chunk) => chunk.candidates.map(({ id }) => id))).toEqual([
			['candidate_0000', 'candidate_0001'],
			['candidate_0002'],
		]);
		expect(first.chunks.flatMap((chunk) => chunk.candidates.map(({ index }) => index))).toEqual([
			0, 1, 2,
		]);
	});

	test('returns no requests for empty or fully filtered candidate input', () => {
		expect(
			buildDecisionRequests({
				model: 'jev-1.14.0',
				body: 'x'.repeat(100_000),
				fieldName: 'tags',
				instructions: '',
				candidates: [],
			})
		).toEqual({ ok: true, chunks: [] });
		expect(
			buildDecisionRequests({
				model: 'jev-1.14.0',
				body: 'body',
				fieldName: 'tags',
				instructions: '',
				candidates: ['', ' \t', '\n'],
			})
		).toEqual({ ok: true, chunks: [] });
	});

	test('fails safely on oversized UTF-8 context without truncating or exposing input', () => {
		const body = '한'.repeat(8_300);
		const result = buildDecisionRequests({
			model: 'jev-1.14.0',
			body,
			fieldName: 'tags',
			instructions: '',
			candidates: ['candidate'],
		});
		expect(result).toEqual({ ok: false, error: { code: 'question-context-too-large' } });
		expect(JSON.stringify(result)).not.toContain(body);
	});

	test('budgets the serialized state including user instructions', () => {
		const instructions = '한'.repeat(8_300);
		const result = buildDecisionRequests({
			model: 'jev-1.14.0',
			body: 'short body',
			fieldName: 'tags',
			instructions,
			candidates: ['candidate'],
		});
		expect(result).toEqual({ ok: false, error: { code: 'question-context-too-large' } });
		expect(JSON.stringify(result)).not.toContain(instructions);
	});

	test('rejects malformed inputs with a safe typed error', () => {
		const result = buildDecisionRequests({
			model: '',
			body: 'private body',
			fieldName: 'tags',
			instructions: '',
			candidates: ['private candidate'],
		});
		expect(result).toEqual({ ok: false, error: { code: 'invalid-input' } });
		expect(JSON.stringify(result)).not.toContain('private');
	});
});

describe('decodeSystemOneResponse', () => {
	test('decodes exact Noul answers', () => {
		expect(
			decodeSystemOneResponse(
				validResponse({
					candidate_0000: { type: 'noul', noul: 0 },
					candidate_0001: { type: 'noul', noul: 1 },
				}),
				['candidate_0000', 'candidate_0001']
			)
		).toEqual({
			ok: true,
			probabilities: Object.assign(Object.create(null), { candidate_0000: 0, candidate_0001: 1 }),
		});
	});

	test.each([
		['missing answer', {}, ['candidate_0000'], 'answer-set-mismatch'],
		[
			'one answer missing',
			{ candidate_0000: { type: 'noul', noul: 0.5 } },
			['candidate_0000', 'candidate_0001'],
			'answer-set-mismatch',
		],
		[
			'extra answer',
			{ candidate_0000: { type: 'noul', noul: 0.5 }, extra: { type: 'noul', noul: 0.2 } },
			['candidate_0000'],
			'answer-set-mismatch',
		],
		[
			'wrong type',
			{ candidate_0000: { type: 'choice', noul: 0.5 } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'confidence alias only',
			{ candidate_0000: { type: 'noul', confidence: 0.5 } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'reliability alias only',
			{ candidate_0000: { type: 'noul', reliability: 0.5 } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'NaN',
			{ candidate_0000: { type: 'noul', noul: Number.NaN } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'positive infinity',
			{ candidate_0000: { type: 'noul', noul: Number.POSITIVE_INFINITY } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'negative infinity',
			{ candidate_0000: { type: 'noul', noul: Number.NEGATIVE_INFINITY } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'below range',
			{ candidate_0000: { type: 'noul', noul: -0.01 } },
			['candidate_0000'],
			'invalid-answer',
		],
		[
			'above range',
			{ candidate_0000: { type: 'noul', noul: 1.01 } },
			['candidate_0000'],
			'invalid-answer',
		],
	] as const)('rejects %s', (_label, answers, expectedIds, code) => {
		const result = decodeSystemOneResponse(validResponse(answers), expectedIds);
		expect(result).toEqual({ ok: false, error: { code } });
		expect(JSON.stringify(result)).not.toContain('candidate_0000');
	});

	test('safely handles __proto__ as an expected answer key', () => {
		const answers = JSON.parse('{"__proto__":{"type":"noul","noul":0.7}}') as Record<
			string,
			unknown
		>;
		const result = decodeSystemOneResponse(validResponse(answers), ['__proto__']);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.probabilities['__proto__']).toBe(0.7);
		expect(Object.getPrototypeOf(result.probabilities)).toBeNull();
	});

	test('rejects duplicate expected ids and malformed response objects', () => {
		expect(
			decodeSystemOneResponse(validResponse(), ['candidate_0000', 'candidate_0000'])
		).toEqual({
			ok: false,
			error: { code: 'invalid-expected-ids' },
		});
		expect(decodeSystemOneResponse(null, ['candidate_0000'])).toEqual({
			ok: false,
			error: { code: 'invalid-response' },
		});
	});
});
