import type { AutoClassifierSettings, OAuthTokens, ProviderConfig } from '../types';
import {
	ClassificationStateError,
	copyProvider,
	providerHasAuth,
	sameProvider,
} from '../domain/classification-state';
import type { FieldSnapshot } from '../domain/classification-state';
import { validateGeneratedTags } from '../domain/tag-generation';
import { generateTags } from './provider-api';
import { HttpError } from './request';

export class GenerationFailedError extends Error {
	constructor() {
		super('New tags could not be generated safely');
		this.name = 'GenerationFailedError';
	}
}

interface GenerationContext {
	getSettings: () => AutoClassifierSettings;
	saveSettings: () => Promise<void>;
	snapshot: FieldSnapshot;
	body: string;
	deadline: number;
	assertCurrent: () => void;
}

/** Provider settings become relevant only if the result policy requests generation. */
export function createGenerationStage(context: GenerationContext) {
	let expected: ProviderConfig | undefined;
	let providerName = '';
	let model = '';
	const assertCurrent = () => {
		context.assertCurrent();
		if (!expected) return;
		const live = context.getSettings();
		if (
			live.selectedProvider !== providerName ||
			live.selectedModel !== model ||
			!sameProvider(
				live.providers.find((provider) => provider.name === providerName),
				expected
			)
		) {
			throw new ClassificationStateError('provider-changed');
		}
	};
	const refreshTokens = async (tokens: OAuthTokens) => {
		assertCurrent();
		const live = context.getSettings();
		const current = live.providers.find((provider) => provider.name === providerName);
		if (!current || !expected) throw new ClassificationStateError('provider-changed');
		const next = copyProvider(expected);
		if (next.auth?.type === 'oauth') next.auth.oauth = { ...tokens };
		else if (next.authType === 'oauth' || next.oauth) next.oauth = { ...tokens };
		else throw new ClassificationStateError('provider-changed');
		if (current.auth?.type === 'oauth') current.auth.oauth = { ...tokens };
		else current.oauth = { ...tokens };
		await context.saveSettings();
		context.assertCurrent();
		const saved = context.getSettings();
		if (
			saved.selectedProvider !== providerName ||
			saved.selectedModel !== model ||
			!sameProvider(
				saved.providers.find((provider) => provider.name === providerName),
				next
			)
		) {
			throw new ClassificationStateError('provider-changed');
		}
		expected = next;
	};
	const generate = async ({
		excluded,
		minimum,
		maximum,
	}: {
		excluded: string[];
		minimum: number;
		maximum: number;
	}): Promise<string[]> => {
		context.assertCurrent();
		const settings = context.getSettings();
		providerName = settings.selectedProvider;
		model = settings.selectedModel;
		const configured = settings.providers.find((provider) => provider.name === providerName);
		if (
			!configured ||
			!model ||
			!configured.models.some((item) => item.id === model) ||
			!providerHasAuth(configured)
		)
			throw new GenerationFailedError();
		expected = copyProvider(configured);
		const field = context.snapshot;
		try {
			const result = await generateTags(
				{
					fieldName: field.name,
					enabled: field.generateNewTags,
					body: context.body,
					instructions: [field.instructions, field.fieldInstructions].filter(Boolean).join('\n\n'),
					excluded,
					minimum,
					maximum,
					deadline: context.deadline,
					assertCurrent,
				},
				expected,
				model,
				refreshTokens
			);
			assertCurrent();
			return validateGeneratedTags(result, excluded, maximum);
		} catch (error) {
			if (error instanceof ClassificationStateError) throw error;
			if (error instanceof HttpError && error.code === 'TIMEOUT') throw error;
			throw new GenerationFailedError();
		}
	};
	return { generate, assertCurrent };
}
