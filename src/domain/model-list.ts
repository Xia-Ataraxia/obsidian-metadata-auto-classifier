import type { AutoClassifierSettings, Model, ProviderConfig } from '../types';
import providerPresetsData from './presets.json';
import { findUniqueProvider, PROVIDER_NAMES } from '../utils/lib-utils';
import { providerHasAuth } from './classification-state';
import { decisionTransport } from './decision-formats';

export interface ModelRef {
	provider: string;
	model: string;
}

export interface ModelSelection {
	selectedProvider: string;
	selectedModel: string;
}

export function isDuplicateModel(
	providers: ProviderConfig[],
	provider: string,
	modelId: string,
	editing?: ModelRef
): boolean {
	if (editing && editing.provider === provider && editing.model === modelId) return false;
	const target = providers.find((p) => p.name === provider);
	return target?.models.some((m) => m.id === modelId) ?? false;
}

// Edits keep the row's position and only move the selection when the edited model was selected
export function saveModel(
	providers: ProviderConfig[],
	selection: ModelSelection,
	provider: string,
	model: Model,
	editing?: ModelRef
): void {
	const target = providers.find((p) => p.name === provider);
	if (!target) return;

	if (!editing) {
		target.models.push(model);
		return;
	}

	const source = providers.find((p) => p.name === editing.provider);
	const index = source?.models.findIndex((m) => m.id === editing.model) ?? -1;
	if (source === target && index >= 0) {
		target.models[index] = model;
	} else {
		if (source && index >= 0) source.models.splice(index, 1);
		target.models.push(model);
	}

	if (selection.selectedProvider === editing.provider && selection.selectedModel === editing.model) {
		selection.selectedProvider = provider;
		selection.selectedModel = model.id;
	}
}

export interface ModelTarget {
	provider: ProviderConfig;
	model: Model;
}

export function findModelTarget(
	providers: ReadonlyArray<ProviderConfig>,
	providerName: string,
	modelId: string
): ModelTarget | undefined {
	const provider = findUniqueProvider(providers, providerName);
	const model = modelId ? provider?.models.find((item) => item.id === modelId) : undefined;
	return provider && model ? { provider, model } : undefined;
}

/** The selected model when it fits the role, otherwise the first authenticated model that does. */
function roleTarget(settings: AutoClassifierSettings, decision: boolean): ModelTarget | undefined {
	const fits = (target: ModelTarget) =>
		!!decisionTransport(target.provider.name, target.model) === decision;
	const selected = findModelTarget(settings.providers, settings.selectedProvider, settings.selectedModel);
	if (selected && fits(selected)) return selected;
	for (const provider of settings.providers) {
		if (!providerHasAuth(provider)) continue;
		for (const model of provider.models) {
			const target = findModelTarget(settings.providers, provider.name, model.id);
			if (target && fits(target)) return target;
		}
	}
	return undefined;
}

/** Only decision API models classify; chat models never emulate decisions. */
export function classificationTarget(settings: AutoClassifierSettings): ModelTarget | undefined {
	return roleTarget(settings, true);
}

/** Decision models cannot write free text, so only chat models generate tags. */
export function generationTarget(settings: AutoClassifierSettings): ModelTarget | undefined {
	return roleTarget(settings, false);
}

/** 1.13 stored a standalone Jev key; it becomes a selected TypeSafe provider so classification keeps working. */
export function migrateLegacyJev(settings: AutoClassifierSettings & { jev?: unknown }): void {
	const { jev } = settings;
	delete settings.jev;
	if (typeof jev !== 'object' || jev === null) return;
	const apiKey = 'apiKey' in jev && typeof jev.apiKey === 'string' ? jev.apiKey.trim() : '';
	if (!apiKey || settings.providers.some((p) => p.name === PROVIDER_NAMES.TYPESAFE)) return;
	const preset = providerPresetsData.typesafe;
	const stored = 'model' in jev && typeof jev.model === 'string' ? jev.model.trim() : '';
	const modelId = stored || 'jev-1.14.0';
	settings.providers = [
		...settings.providers,
		{
			name: preset.name,
			baseUrl: preset.baseUrl,
			temperature: preset.temperature,
			models: [{ id: modelId, name: modelId, decision: true }],
			auth: { type: 'apiKey', apiKey },
		},
	];
	settings.selectedProvider = preset.name;
	settings.selectedModel = modelId;
}
