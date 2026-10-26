import type { Model } from '../types';
import type { DecisionRequest, DecisionTransport } from '../types/decision';
import { PROVIDER_NAMES } from '../utils/lib-utils';

/** Decision API endpoint for the model; undefined means a chat model, which never classifies. */
export function decisionTransport(
	providerName: string,
	model: Pick<Model, 'decision'>
): DecisionTransport | undefined {
	if (providerName === PROVIDER_NAMES.CODEX) return undefined;
	if (providerName === PROVIDER_NAMES.TYPESAFE) return 'systemone';
	if (!model.decision) return undefined;
	return providerName === PROVIDER_NAMES.OPENAI ? 'openai-decisions' : 'systemone';
}

export function decisionEndpoint(baseUrl: string, transport: DecisionTransport): string {
	const path = transport === 'openai-decisions' ? '/decisions' : '/systemone';
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	if (trimmed.endsWith(path)) return trimmed;
	return trimmed.replace(/\/chat\/completions$/, '') + path;
}

function stateInput(request: DecisionRequest): string {
	return `State (JSON):\n${JSON.stringify(request.state)}`;
}

export function toOpenAIDecisionsRequest(request: DecisionRequest): object {
	return {
		model: request.model,
		input: stateInput(request),
		questions: Object.entries(request.questions).map(([name, question]) => ({
			type: 'predicate',
			name,
			instructions: question.instructions,
		})),
	};
}
