export interface JevQuestion {
	type: 'noul';
	instructions: string;
}

export interface JevState {
	body: string;
	fieldName: string;
	instructions: string;
}

export interface JevRequest {
	model: string;
	state: JevState;
	questions: Record<string, JevQuestion>;
}

export interface JevCandidateMapping {
	id: string;
	value: string;
	index: number;
}

export interface JevRequestChunk {
	request: JevRequest;
	candidates: JevCandidateMapping[];
}

export interface BuildJevRequestsInput {
	model: string;
	body: string;
	fieldName: string;
	instructions: string;
	candidates: string[];
}

export type JevBuildErrorCode =
	| 'invalid-input'
	| 'question-context-too-large'
	| 'request-context-too-large';

export type BuildJevRequestsResult =
	| { ok: true; chunks: JevRequestChunk[] }
	| { ok: false; error: { code: JevBuildErrorCode } };

export interface JevUsage {
	input_tokens: number;
	output_tokens: number;
}

export type JevDecodeErrorCode =
	| 'invalid-expected-ids'
	| 'invalid-response'
	| 'model-mismatch'
	| 'answer-set-mismatch'
	| 'invalid-answer'
	| 'invalid-usage';

export type DecodeJevResponseResult =
	| { ok: true; probabilities: Record<string, number>; usage: JevUsage }
	| { ok: false; error: { code: JevDecodeErrorCode } };

export type JevSelectionResult =
	| { status: 'selected'; values: string[] }
	| { status: 'empty'; values: [] }
	| { status: 'abstain' }
	| { status: 'no-candidates' }
	| { status: 'invalid'; error: { code: JevSelectionErrorCode } };

export type JevSelectionErrorCode =
	| 'invalid-input'
	| 'probability-set-mismatch'
	| 'invalid-probability';
