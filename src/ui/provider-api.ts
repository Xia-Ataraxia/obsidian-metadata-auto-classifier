import { COMMON_CONSTANTS } from '../domain/constants';
import { decisionTransport } from '../domain/decision-formats';
import {
	buildTagGenerationPrompt,
	isTagGenerationAllowed,
	validateGeneratedTags,
} from '../domain/tag-generation';
import { HttpError } from './request';
import type { OnTokenRefreshCallback, ProviderConfig } from '../types';
import { DecisionClassifier } from './DecisionClassifier';
import { UnifiedProvider } from './UnifiedProvider';
import type { HttpRequestOptions } from './request';

export interface GenerateTagsInput {
	fieldName: string;
	enabled: unknown;
	body: string;
	instructions: string;
	excluded: string[];
	minimum: number;
	maximum: number;
	deadline: number;
	assertCurrent: () => void;
}

const TAG_GENERATION_SYSTEM_ROLE =
	'Generate new Obsidian tags and return only the required JSON object.';

function assertGenerationCurrent(input: GenerateTagsInput): void {
	input.assertCurrent();
	if (!Number.isFinite(input.deadline) || Date.now() >= input.deadline) {
		throw new HttpError('TIMEOUT');
	}
}

export const testModel = async (
	providerConfig: ProviderConfig,
	modelName: string,
	onTokenRefresh?: OnTokenRefreshCallback,
	requestOptions?: HttpRequestOptions
): Promise<void> => {
	const model = providerConfig.models.find((item) => item.id === modelName);
	if (model && decisionTransport(providerConfig.name, model)) {
		// A one-question probe exercises the same endpoint, auth and decoder as classification.
		await new DecisionClassifier().classify(
			{ body: 'Connection test', fieldName: 'test', instructions: '', candidates: ['ok'], max: 1 },
			providerConfig,
			model,
			{
				deadline: requestOptions?.deadline ?? Date.now() + 30_000,
				assertCurrent: requestOptions?.assertCurrent ?? (() => {}),
				onTokenRefresh,
			}
		);
		return;
	}
	await new UnifiedProvider().callAPI(
		COMMON_CONSTANTS.VERIFY_CONNECTION_SYSTEM_PROMPT,
		COMMON_CONSTANTS.VERIFY_CONNECTION_USER_PROMPT,
		providerConfig,
		modelName,
		undefined,
		onTokenRefresh,
		requestOptions
	);
};

export async function generateTags(
	input: GenerateTagsInput,
	providerConfig: ProviderConfig,
	model: string,
	onTokenRefresh?: OnTokenRefreshCallback
): Promise<string[]> {
	if (
		!input ||
		!isTagGenerationAllowed({ name: input.fieldName, generateNewTags: input.enabled })
	) {
		return [];
	}
	if (input.maximum === 0) return [];

	const userPrompt = buildTagGenerationPrompt({
		body: input.body,
		instructions: input.instructions,
		excluded: input.excluded,
		minimum: input.minimum,
		maximum: input.maximum,
	});
	assertGenerationCurrent(input);
	const response = await new UnifiedProvider().callAPI(
		TAG_GENERATION_SYSTEM_ROLE,
		userPrompt,
		providerConfig,
		model,
		undefined,
		onTokenRefresh,
		{ deadline: input.deadline, assertCurrent: input.assertCurrent }
	);
	assertGenerationCurrent(input);
	return validateGeneratedTags(response.tags, input.excluded, input.maximum);
}
