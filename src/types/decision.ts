export type DecisionTransport = 'systemone' | 'openai-decisions' | 'chat';

export interface DecisionQuestion {
	type: 'noul';
	instructions: string;
}

export interface DecisionState {
	body: string;
	fieldName: string;
	instructions: string;
}

export interface DecisionRequest {
	model: string;
	state: DecisionState;
	questions: Record<string, DecisionQuestion>;
}

export interface DecisionCandidateMapping {
	id: string;
	value: string;
	index: number;
}

export interface DecisionRequestChunk {
	request: DecisionRequest;
	candidates: DecisionCandidateMapping[];
}

export interface BuildDecisionRequestsInput {
	model: string;
	body: string;
	fieldName: string;
	instructions: string;
	candidates: string[];
}

export type DecisionBuildErrorCode =
	| 'invalid-input'
	| 'question-context-too-large'
	| 'request-context-too-large';

export type BuildDecisionRequestsResult =
	| { ok: true; chunks: DecisionRequestChunk[] }
	| { ok: false; error: { code: DecisionBuildErrorCode } };

export type DecisionDecodeErrorCode =
	| 'invalid-expected-ids'
	| 'invalid-response'
	| 'answer-set-mismatch'
	| 'invalid-answer';

export type DecodeDecisionResult =
	| { ok: true; probabilities: Record<string, number> }
	| { ok: false; error: { code: DecisionDecodeErrorCode } };

export type DecisionSelectionResult =
	| { status: 'selected'; values: string[] }
	| { status: 'empty'; values: [] }
	| { status: 'abstain' }
	| { status: 'no-candidates' }
	| { status: 'invalid'; error: { code: DecisionSelectionErrorCode } };

export type DecisionSelectionErrorCode =
	| 'invalid-input'
	| 'probability-set-mismatch'
	| 'invalid-probability';
