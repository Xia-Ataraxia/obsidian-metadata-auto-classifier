import type {
	BuildJevRequestsInput,
	BuildJevRequestsResult,
	JevCandidateMapping,
	JevQuestion,
	JevRequestChunk,
	JevState,
} from '../types/jev';

const REQUEST_CONTEXT_BYTE_BUDGET = 48 * 1024;
const QUESTION_CONTEXT_BYTE_BUDGET = 24 * 1024;
const REQUEST_CONTEXT_OVERHEAD_BYTES = 256;
const QUESTION_CONTEXT_OVERHEAD_BYTES = 64;
const utf8Encoder = new TextEncoder();

function isArrayValue(value: unknown): boolean {
	return Array.isArray(value);
}

function serializedUtf8Bytes(value: string | JevState): number {
	const serialized = JSON.stringify(value);
	return serialized === undefined
		? Number.POSITIVE_INFINITY
		: utf8Encoder.encode(serialized).byteLength;
}

function questionInstructions(candidate: string): string {
	return (
		`Does the body in state fit this candidate value for the field in state?\n\n` +
		`Candidate value (verbatim):\n${candidate}`
	);
}

function failBuild(
	code: 'invalid-input' | 'question-context-too-large' | 'request-context-too-large'
): BuildJevRequestsResult {
	return { ok: false, error: { code } };
}

/** UTF-8 budgets are conservative packing heuristics, not token-limit guarantees. */
export function buildJevRequests(input: BuildJevRequestsInput): BuildJevRequestsResult {
	if (
		!input ||
		typeof input.model !== 'string' ||
		input.model.trim().length === 0 ||
		typeof input.body !== 'string' ||
		typeof input.fieldName !== 'string' ||
		typeof input.instructions !== 'string' ||
		!isArrayValue(input.candidates) ||
		input.candidates.some((candidate) => typeof candidate !== 'string')
	)
		return failBuild('invalid-input');

	const unique: JevCandidateMapping[] = [];
	const seen = new Set<string>();
	input.candidates.forEach((value, index) => {
		if (value.trim().length === 0 || seen.has(value)) return;
		seen.add(value);
		unique.push({ id: `candidate_${String(unique.length).padStart(4, '0')}`, value, index });
	});
	if (unique.length === 0) return { ok: true, chunks: [] };

	const state: JevState = {
		body: input.body,
		fieldName: input.fieldName,
		instructions: input.instructions,
	};
	const stateBytes = serializedUtf8Bytes(state);
	const pending: Array<{ mapping: JevCandidateMapping; question: JevQuestion; bytes: number }> = [];
	for (const mapping of unique) {
		const question = {
			type: 'noul' as const,
			instructions: questionInstructions(mapping.value),
		};
		const bytes = serializedUtf8Bytes(question.instructions);
		if (stateBytes + bytes + QUESTION_CONTEXT_OVERHEAD_BYTES > QUESTION_CONTEXT_BYTE_BUDGET) {
			return failBuild('question-context-too-large');
		}
		pending.push({ mapping, question, bytes });
	}

	const chunks: JevRequestChunk[] = [];
	let current: JevRequestChunk | undefined;
	let currentBytes = stateBytes + REQUEST_CONTEXT_OVERHEAD_BYTES;
	for (const item of pending) {
		const itemBytes =
			item.bytes + serializedUtf8Bytes(item.mapping.id) + QUESTION_CONTEXT_OVERHEAD_BYTES;
		if (!current || currentBytes + itemBytes > REQUEST_CONTEXT_BYTE_BUDGET) {
			current = {
				request: {
					model: input.model,
					state,
					questions: Object.create(null) as Record<string, JevQuestion>,
				},
				candidates: [],
			};
			chunks.push(current);
			currentBytes = stateBytes + REQUEST_CONTEXT_OVERHEAD_BYTES;
		}
		if (currentBytes + itemBytes > REQUEST_CONTEXT_BYTE_BUDGET)
			return failBuild('request-context-too-large');
		current.request.questions[item.mapping.id] = item.question;
		current.candidates.push(item.mapping);
		currentBytes += itemBytes;
	}
	return { ok: true, chunks };
}
