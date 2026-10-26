import type {
	DecodeDecisionResult,
	DecisionCandidateMapping,
	DecisionSelectionResult,
} from '../types/decision';

const YES_THRESHOLD = 0.7;
const NO_THRESHOLD = 0.3;

function isArrayValue(value: unknown): boolean {
	return Array.isArray(value);
}

function invalid(
	code: 'invalid-input' | 'probability-set-mismatch' | 'invalid-probability'
): DecisionSelectionResult {
	return { status: 'invalid', error: { code } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeAnswers(
	answers: unknown,
	expectedIds: readonly string[],
	readProbability: (answer: unknown) => number | undefined
): DecodeDecisionResult {
	if (
		!isArrayValue(expectedIds) ||
		expectedIds.length === 0 ||
		expectedIds.some((id) => typeof id !== 'string' || id.length === 0) ||
		new Set(expectedIds).size !== expectedIds.length
	)
		return { ok: false, error: { code: 'invalid-expected-ids' } };
	if (!isRecord(answers)) return { ok: false, error: { code: 'invalid-response' } };
	const answerIds = Object.keys(answers);
	const expectedIdSet = new Set(expectedIds);
	if (answerIds.length !== expectedIds.length || answerIds.some((id) => !expectedIdSet.has(id))) {
		return { ok: false, error: { code: 'answer-set-mismatch' } };
	}

	const probabilities = Object.create(null) as Record<string, number>;
	for (const id of expectedIds) {
		if (!Object.prototype.hasOwnProperty.call(answers, id)) {
			return { ok: false, error: { code: 'answer-set-mismatch' } };
		}
		const probability = readProbability(answers[id]);
		if (
			typeof probability !== 'number' ||
			!Number.isFinite(probability) ||
			probability < 0 ||
			probability > 1
		) {
			return { ok: false, error: { code: 'invalid-answer' } };
		}
		probabilities[id] = probability;
	}
	return { ok: true, probabilities };
}

/** Decode only the documented System One Noul answer shape; failures never include response data. */
export function decodeSystemOneResponse(
	response: unknown,
	expectedIds: readonly string[]
): DecodeDecisionResult {
	if (!isRecord(response)) return { ok: false, error: { code: 'invalid-response' } };
	return decodeAnswers(response.answers, expectedIds, (answer) =>
		isRecord(answer) && answer.type === 'noul' && typeof answer.noul === 'number'
			? answer.noul
			: undefined
	);
}

/** Decode the OpenAI Decisions predicate list keyed by question name. */
export function decodeOpenAIDecisionsResponse(
	response: unknown,
	expectedIds: readonly string[]
): DecodeDecisionResult {
	if (!isRecord(response) || !Array.isArray(response.answers)) {
		return { ok: false, error: { code: 'invalid-response' } };
	}
	const byName = Object.create(null) as Record<string, unknown>;
	for (const answer of response.answers as unknown[]) {
		if (!isRecord(answer) || typeof answer.name !== 'string' || answer.name in byName) {
			return { ok: false, error: { code: 'answer-set-mismatch' } };
		}
		byName[answer.name] = answer;
	}
	return decodeAnswers(byName, expectedIds, (answer) => {
		if (!isRecord(answer)) return undefined;
		// A refusal is uncertainty: never selected, and it blocks an all-no empty result.
		if (answer.type === 'refusal') return 0.5;
		return answer.type === 'predicate' && typeof answer.probability === 'number'
			? answer.probability
			: undefined;
	});
}

/** Decode the structured-output emulation used by chat-only providers. */
/** Select only confident yes candidates; uncertainty is never filled to satisfy a minimum. */
export function selectDecisionCandidates(
	candidates: readonly DecisionCandidateMapping[],
	probabilities: Readonly<Record<string, number>>,
	max: number
): DecisionSelectionResult {
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
	const scored: Array<{ candidate: DecisionCandidateMapping; probability: number }> = [];
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
