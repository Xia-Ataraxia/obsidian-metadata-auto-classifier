import { buildJevRequests } from '../domain/jev-questions';
import { decodeJevResponse, selectJevCandidates } from '../domain/jev-selection';
import type { JevCandidateMapping, JevSelectionResult } from '../types/jev';
import { sendRequest } from './request';

export class JevClassificationError extends Error {
	constructor(readonly code: string) {
		super('Jev classification did not complete safely');
		this.name = 'JevClassificationError';
	}
}

export interface JevClassificationInput {
	body: string;
	fieldName: string;
	instructions: string;
	candidates: string[];
	max: number;
}

export interface JevOperationControl {
	deadline: number;
	assertCurrent: () => void;
}

/** All candidate chunks must succeed before any selection is returned. */
export class JevClassifier {
	async classify(
		input: JevClassificationInput,
		config: { apiKey: string; model: string },
		control: JevOperationControl
	): Promise<JevSelectionResult> {
		const assertCurrent = () => {
			if (Date.now() >= control.deadline) throw new JevClassificationError('expired');
			control.assertCurrent();
		};
		assertCurrent();
		if (input.candidates.every((value) => value.trim().length === 0)) {
			return { status: 'no-candidates' };
		}
		const apiKey = config.apiKey.trim();
		const model = config.model.trim();
		if (!apiKey || !model) throw new JevClassificationError('missing-config');
		const built = buildJevRequests({ ...input, model });
		if (!built.ok) throw new JevClassificationError(built.error.code);
		const candidates: JevCandidateMapping[] = [];
		const probabilities: Record<string, number> = Object.create(null) as Record<string, number>;
		for (const chunk of built.chunks) {
			assertCurrent();
			const response = await sendRequest(
				'https://api.typesafe.ai/v1/systemone',
				{ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
				chunk.request,
				{ deadline: control.deadline, assertCurrent }
			);
			assertCurrent();
			const decoded = decodeJevResponse(
				response,
				chunk.candidates.map((candidate) => candidate.id),
				model
			);
			if (!decoded.ok) throw new JevClassificationError(decoded.error.code);
			candidates.push(...chunk.candidates);
			Object.assign(probabilities, decoded.probabilities);
		}
		assertCurrent();
		const result = selectJevCandidates(candidates, probabilities, input.max);
		if (result.status === 'invalid') throw new JevClassificationError(result.error.code);
		return result;
	}
}
