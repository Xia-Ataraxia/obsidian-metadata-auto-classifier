import type { Model, ProviderConfig } from '../types';
import providerPresetsData from './presets.json';

// Exact ids this plugin once shipped as presets; ids a user typed themselves stay untouched.
// Local providers are excluded because their models are whatever the user has downloaded.
const RETIRED_MODELS: Record<string, Record<string, string>> = {
	OpenAI: {
		'gpt-3.5-turbo': 'gpt-6.1-terra',
		'gpt-4-turbo': 'gpt-6.1-terra',
		'gpt-4.1': 'gpt-6.1-terra',
		'gpt-4.1-mini': 'gpt-6.1-terra',
	},
	Anthropic: {
		'claude-3-7-sonnet-20250219': 'claude-sonnet-5-5',
		'claude-sonnet-4-20250514': 'claude-sonnet-5-5',
		'claude-sonnet-4-6': 'claude-sonnet-5-5',
		'claude-opus-4-20250514': 'claude-opus-5-5',
		'claude-opus-4-6': 'claude-opus-5-5',
	},
	Gemini: {
		'gemini-2.0-flash': 'gemini-3.8-flash',
		'gemini-2.5-flash': 'gemini-3.8-flash',
		'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
		'gemini-2.5-pro': 'gemini-4-argon',
	},
	Codex: {
		'gpt-5.2': 'gpt-6.1-sol',
		'gpt-5.4': 'gpt-6.1-sol',
		'gpt-5.5': 'gpt-6.1-sol',
		'gpt-5.4-mini': 'gpt-6-luna',
	},
	DeepSeek: {
		'deepseek-chat': 'deepseek-flash',
		'deepseek-v4-flash': 'deepseek-flash',
		'deepseek-reasoner': 'deepseek-v4-pro',
	},
	OpenRouter: {
		'typesafe/jev-1.14': 'typesafe/jev-router',
	},
};

function presetModel(providerName: string, modelId: string): Model | undefined {
	const preset = Object.values(providerPresetsData).find((item) => item.name === providerName);
	return (preset?.popularModels)?.find((model) => model.id === modelId);
}

export interface MigratedModel {
	provider: string;
	from: string;
	to: string;
}

interface MigratableSettings {
	providers: ProviderConfig[];
	selectedProvider: string;
	selectedModel: string;
}

export function migrateRetiredModels(settings: MigratableSettings): MigratedModel[] {
	const migrated: MigratedModel[] = [];
	for (const provider of settings.providers) {
		const retired = RETIRED_MODELS[provider.name];
		if (!retired || !Array.isArray(provider.models)) continue;
		const next: Model[] = [];
		for (const model of provider.models) {
			const successorId = Object.prototype.hasOwnProperty.call(retired, model.id)
				? retired[model.id]
				: undefined;
			const successor = successorId ? presetModel(provider.name, successorId) : undefined;
			if (!successor) {
				next.push(model);
				continue;
			}
			migrated.push({ provider: provider.name, from: model.id, to: successor.id });
			if (settings.selectedProvider === provider.name && settings.selectedModel === model.id) {
				settings.selectedModel = successor.id;
			}
			const isDuplicate =
				next.some((item) => item.id === successor.id) ||
				provider.models.some((item) => item.id === successor.id);
			if (!isDuplicate) next.push({ ...successor });
		}
		provider.models = next;
	}
	return migrated;
}
