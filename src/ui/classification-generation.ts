import type { AutoClassifierSettings } from '../types';
import { ClassificationStateError, providerHasAuth } from '../domain/classification-state';
import type { FieldSnapshot } from '../domain/classification-state';
import { validateGeneratedTags } from '../domain/tag-generation';
import { findUniqueProvider } from '../utils/lib-utils';
import { createProviderSession } from './provider-session';
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
	onPersistFailed?: () => void;
	snapshot: FieldSnapshot;
	body: string;
	deadline: number;
	assertCurrent: () => void;
}

/** Provider settings become relevant only if the result policy requests generation. */
export function createGenerationStage(context: GenerationContext) {
	let session: ReturnType<typeof createProviderSession> | undefined;
	const assertCurrent = () => {
		if (session) session.assertCurrent();
		else context.assertCurrent();
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
		const providerName = settings.selectedProvider;
		const model = settings.selectedModel;
		const getProvider = () => findUniqueProvider(context.getSettings().providers, providerName);
		const configured = getProvider();
		if (
			!configured ||
			!model ||
			!configured.models.some((item) => item.id === model) ||
			!providerHasAuth(configured)
		)
			throw new GenerationFailedError();
		session = createProviderSession({
			getProvider,
			saveSettings: () => context.saveSettings(),
			onPersistFailed: context.onPersistFailed,
			assertCurrent: () => {
				context.assertCurrent();
				const live = context.getSettings();
				if (live.selectedProvider !== providerName || live.selectedModel !== model)
					throw new ClassificationStateError('provider-changed');
			},
		});
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
				session.provider,
				model,
				session.refreshTokens
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
