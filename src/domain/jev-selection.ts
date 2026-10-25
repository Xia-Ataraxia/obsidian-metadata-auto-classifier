import type {
	DecodeJevResponseResult,
	JevCandidateMapping,
	JevSelectionResult,
} from '../types/jev';

const YES_THRESHOLD = 0.7;
const NO_THRESHOLD = 0.3;

function isArrayValue(value: unknown): boolean {
	return Array.isArray(value);
}

function invalid(
	code: 'invalid-input' | 'probability-set-mismatch' | 'invalid-probability'
): JevSelectionResult {
	return { status: 'invalid', error: { code } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decode only the documented Noul answer shape; failures never include response data. */
export function decodeJevResponse(
	response: unknown,
	expectedIds: readonly string[],
	expectedModel: string
): DecodeJevResponseResult {
	if (
		!isArrayValue(expectedIds) ||
		expectedIds.length === 0 ||
		expectedIds.some((id) => typeof id !== 'string' || id.length === 0) ||
		new Set(expectedIds).size !== expectedIds.length ||
		typeof expectedModel !== 'string' ||
		expectedModel.length === 0
	)
		return { ok: false, error: { code: 'invalid-expected-ids' } };
	if (!isRecord(response)) return { ok: false, error: { code: 'invalid-response' } };
	if (response.model !== expectedModel) return { ok: false, error: { code: 'model-mismatch' } };
	if (!isRecord(response.answers)) return { ok: false, error: { code: 'invalid-response' } };
	const answerIds = Object.keys(response.answers);
	const expectedIdSet = new Set(expectedIds);
	if (answerIds.length !== expectedIds.length || answerIds.some((id) => !expectedIdSet.has(id))) {
		return { ok: false, error: { code: 'answer-set-mismatch' } };
	}

	const probabilities = Object.create(null) as Record<string, number>;
	for (const id of expectedIds) {
		if (!Object.prototype.hasOwnProperty.call(response.answers, id)) {
			return { ok: false, error: { code: 'answer-set-mismatch' } };
		}
		const answer = response.answers[id];
		if (
			!isRecord(answer) ||
			answer.type !== 'noul' ||
			typeof answer.noul !== 'number' ||
			!Number.isFinite(answer.noul) ||
			answer.noul < 0 ||
			answer.noul > 1
		) {
			return { ok: false, error: { code: 'invalid-answer' } };
		}
		probabilities[id] = answer.noul;
	}
	if (
		!isRecord(response.usage) ||
		typeof response.usage.input_tokens !== 'number' ||
		typeof response.usage.output_tokens !== 'number' ||
		!Number.isFinite(response.usage.input_tokens) ||
		response.usage.input_tokens < 0 ||
		!Number.isFinite(response.usage.output_tokens) ||
		response.usage.output_tokens < 0
	) {
		return { ok: false, error: { code: 'invalid-usage' } };
	}
	return {
		ok: true,
		probabilities,
		usage: {
			input_tokens: response.usage.input_tokens,
			output_tokens: response.usage.output_tokens,
		},
	};
}

/** Select only confident yes candidates; uncertainty is never filled to satisfy a minimum. */
export function selectJevCandidates(
	candidates: readonly JevCandidateMapping[],
	probabilities: Readonly<Record<string, number>>,
	max: number
): JevSelectionResult {
	if (
		!isArrayValue(candidates) ||
		!probabilities ||
		typeof probabilities !== 'object' ||
		!Number.isInteger(max) ||
		max < 1
	)
		return invalid('invalid-input');
	const ids = new Set<string>();
	const indices = new Set<number>();
	for (const candidate of candidates) {
		if (
			!candidate ||
			typeof candidate.id !== 'string' ||
			candidate.id.length === 0 ||
			typeof candidate.value !== 'string' ||
			candidate.value.length === 0 ||
			!Number.isInteger(candidate.index) ||
			candidate.index < 0 ||
			ids.has(candidate.id) ||
			indices.has(candidate.index)
		)
			return invalid('invalid-input');
		ids.add(candidate.id);
		indices.add(candidate.index);
	}
	const probabilityIds = Object.keys(probabilities);
	if (probabilityIds.length !== ids.size || probabilityIds.some((id) => !ids.has(id))) {
		return invalid('probability-set-mismatch');
	}
	const scored: Array<{ candidate: JevCandidateMapping; probability: number }> = [];
	for (const candidate of candidates) {
		const probability = probabilities[candidate.id];
		if (
			typeof probability !== 'number' ||
			!Number.isFinite(probability) ||
			probability < 0 ||
			probability > 1
		) {
			return invalid('invalid-probability');
		}
		scored.push({ candidate, probability });
	}
	if (candidates.length === 0) return { status: 'no-candidates' };

	const yes = scored
		.filter(({ probability }) => probability >= YES_THRESHOLD)
		.sort(
			(left, right) =>
				right.probability - left.probability || left.candidate.index - right.candidate.index
		)
		.slice(0, max);
	if (yes.length > 0)
		return { status: 'selected', values: yes.map(({ candidate }) => candidate.value) };
	if (scored.some(({ probability }) => probability > NO_THRESHOLD)) return { status: 'abstain' };
	return { status: 'empty', values: [] };
}
