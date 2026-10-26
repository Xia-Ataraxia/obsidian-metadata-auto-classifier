import type { Model, OnTokenRefreshCallback, ProviderConfig } from '../types';
import {
	decisionEndpoint,
	decisionTransport,
	toOpenAIDecisionsRequest,
} from '../domain/decision-formats';
import { buildDecisionRequests } from '../domain/decision-questions';
import {
	decodeOpenAIDecisionsResponse,
	decodeSystemOneResponse,
	selectDecisionCandidates,
} from '../domain/decision-selection';
import type {
	DecisionCandidateMapping,
	DecisionRequest,
	DecisionSelectionResult,
	DecodeDecisionResult,
} from '../types/decision';
import { PROVIDER_NAMES } from '../utils/lib-utils';
import { resolveApiKey } from './UnifiedProvider';
import { sendRequest } from './request';

export class DecisionClassificationError extends Error {
	constructor(readonly code: string) {
		super('Decision classification did not complete safely');
		this.name = 'DecisionClassificationError';
	}
}

export interface DecisionClassificationInput {
	body: string;
	fieldName: string;
	instructions: string;
	candidates: string[];
	max: number;
}

export interface DecisionOperationControl {
	deadline: number;
	assertCurrent: () => void;
	onTokenRefresh?: OnTokenRefreshCallback;
}

/** All candidate chunks must succeed before any selection is returned. */
export class DecisionClassifier {
	async classify(
		input: DecisionClassificationInput,
		provider: ProviderConfig,
		model: Model,
		control: DecisionOperationControl
	): Promise<DecisionSelectionResult> {
		const assertCurrent = () => {
			if (Date.now() >= control.deadline) throw new DecisionClassificationError('expired');
			control.assertCurrent();
		};
		assertCurrent();
		if (input.candidates.every((value) => value.trim().length === 0)) {
			return { status: 'no-candidates' };
		}
		const built = buildDecisionRequests({ ...input, model: model.id });
		if (!built.ok) throw new DecisionClassificationError(built.error.code);
		const candidates: DecisionCandidateMapping[] = [];
		const probabilities: Record<string, number> = Object.create(null) as Record<string, number>;
		for (const chunk of built.chunks) {
			assertCurrent();
			const ids = chunk.candidates.map((candidate) => candidate.id);
			const decoded = await this.ask(chunk.request, ids, provider, model, {
				...control,
				assertCurrent,
			});
			assertCurrent();
			if (!decoded.ok) throw new DecisionClassificationError(decoded.error.code);
			candidates.push(...chunk.candidates);
			Object.assign(probabilities, decoded.probabilities);
		}
		assertCurrent();
		const result = selectDecisionCandidates(candidates, probabilities, input.max);
		if (result.status === 'invalid') throw new DecisionClassificationError(result.error.code);
		return result;
	}

	private async ask(
		request: DecisionRequest,
		ids: string[],
		provider: ProviderConfig,
		model: Model,
		control: DecisionOperationControl
	): Promise<DecodeDecisionResult> {
		const transport = decisionTransport(provider.name, model);
		if (!transport) throw new DecisionClassificationError('not-a-decision-model');
		const requestOptions = { deadline: control.deadline, assertCurrent: control.assertCurrent };
		const apiKey = resolveApiKey(provider);
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		if (provider.name === PROVIDER_NAMES.OPENROUTER) headers['X-Title'] = 'Metadata Auto Classifier';
		const url = decisionEndpoint(provider.baseUrl, transport);
		if (transport === 'openai-decisions') {
			const response = await sendRequest(url, headers, toOpenAIDecisionsRequest(request), requestOptions);
			return decodeOpenAIDecisionsResponse(response, ids);
		}
		const response = await sendRequest(url, headers, request, requestOptions);
		return decodeSystemOneResponse(response, ids);
	}
}
