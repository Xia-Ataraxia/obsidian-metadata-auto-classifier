import type { Model, StructuredFormat } from '../types';
import type { DecisionRequest, DecisionTransport } from '../types/decision';
import { PROVIDER_NAMES } from '../utils/lib-utils';

/** Native decision endpoints when the model is marked as such; chat structured output otherwise. */
export function decisionTransport(
	providerName: string,
	model: Pick<Model, 'decision'>
): DecisionTransport {
	if (providerName === PROVIDER_NAMES.CODEX) return 'chat';
	if (providerName === PROVIDER_NAMES.TYPESAFE) return 'systemone';
	if (!model.decision) return 'chat';
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

export const DECISION_CHAT_SYSTEM_ROLE =
	'You answer yes/no questions about a state object. For every question id, return the ' +
	'calibrated probability (0 to 1) that the answer is yes. Use values near 0.5 when unsure. ' +
	'Respond only with the requested JSON.';

export function decisionChatPrompt(request: DecisionRequest): string {
	return JSON.stringify({
		state: request.state,
		questions: Object.fromEntries(
			Object.entries(request.questions).map(([id, question]) => [id, question.instructions])
		),
	});
}

export function decisionChatFormat(ids: readonly string[]): StructuredFormat {
	return {
		name: 'decision_answers',
		schema: {
			type: 'object',
			properties: {
				answers: {
					type: 'object',
					properties: Object.fromEntries(ids.map((id) => [id, { type: 'number' }])),
					required: [...ids],
					additionalProperties: false,
				},
			},
			required: ['answers'],
			additionalProperties: false,
		},
	};
}
