import { selectDecisionCandidates } from '../../src/domain/decision-selection';
import type { DecisionCandidateMapping } from '../../src/types/decision';

const candidates: DecisionCandidateMapping[] = [
	{ id: 'candidate_0000', value: 'first', index: 0 },
	{ id: 'candidate_0001', value: 'second', index: 1 },
];

function probabilities(values: number[]): Record<string, number> {
	return Object.assign(Object.create(null), {
		candidate_0000: values[0] ?? Number.NaN,
		candidate_0001: values[1] ?? Number.NaN,
	});
}

describe('selectDecisionCandidates', () => {
	test.each([[[0.1, 0.5]], [[0.5, 0.1]], [[0.3, 0.6999]]])(
		'abstains when there is no yes and at least one uncertain candidate: %j',
		(values) => {
			expect(selectDecisionCandidates(candidates, probabilities(values), 2)).toEqual({
				status: 'abstain',
			});
		}
	);

	test('returns normal empty only when every candidate is no', () => {
		expect(selectDecisionCandidates(candidates, probabilities([0.1, 0.3]), 2)).toEqual({
			status: 'empty',
			values: [],
		});
	});

	test('selects only confident yes values, even with an abstaining candidate', () => {
		expect(selectDecisionCandidates(candidates, probabilities([0.7, 0.5]), 2)).toEqual({
			status: 'selected',
			values: ['first'],
		});
	});

	test('classifies exact zero, one, and threshold boundaries', () => {
		expect(selectDecisionCandidates(candidates, probabilities([1, 0]), 2)).toEqual({
			status: 'selected',
			values: ['first'],
		});
		expect(selectDecisionCandidates(candidates, probabilities([0.3, 0]), 2)).toEqual({
			status: 'empty',
			values: [],
		});
		expect(selectDecisionCandidates(candidates, probabilities([0, 0.7]), 2)).toEqual({
			status: 'selected',
			values: ['second'],
		});
	});

	test('orders by probability descending and breaks ties by original index before capping max', () => {
		const reversed = [candidates[1], candidates[0]] as DecisionCandidateMapping[];
		const scores = Object.assign(Object.create(null), { candidate_0000: 0.9, candidate_0001: 0.9 });
		expect(selectDecisionCandidates(reversed, scores, 1)).toEqual({
			status: 'selected',
			values: ['first'],
		});
		const ranked = Object.assign(Object.create(null), { candidate_0000: 0.8, candidate_0001: 1 });
		expect(selectDecisionCandidates(candidates, ranked, 1)).toEqual({
			status: 'selected',
			values: ['second'],
		});
	});

	test('returns no-candidates separately from a zero-selection result', () => {
		expect(selectDecisionCandidates([], Object.create(null), 1)).toEqual({ status: 'no-candidates' });
	});

	test.each([
		[
			'missing probability',
			Object.assign(Object.create(null), { candidate_0000: 0.1 }),
			'probability-set-mismatch',
		],
		[
			'extra probability',
			Object.assign(Object.create(null), { candidate_0000: 0.1, candidate_0001: 0.2, extra: 0.3 }),
			'probability-set-mismatch',
		],
		['NaN probability', probabilities([Number.NaN, 0.2]), 'invalid-probability'],
		['infinite probability', probabilities([0.2, Number.POSITIVE_INFINITY]), 'invalid-probability'],
		['out-of-range probability', probabilities([-0.1, 0.2]), 'invalid-probability'],
	] as const)('fails closed on %s instead of returning empty', (_label, scores, code) => {
		expect(selectDecisionCandidates(candidates, scores, 2)).toEqual({
			status: 'invalid',
			error: { code },
		});
	});

	test('rejects an invalid maximum without leaking candidate values', () => {
		const result = selectDecisionCandidates(candidates, probabilities([0.9, 0.1]), 0);
		expect(result).toEqual({ status: 'invalid', error: { code: 'invalid-input' } });
		expect(JSON.stringify(result)).not.toContain('first');
	});
});
