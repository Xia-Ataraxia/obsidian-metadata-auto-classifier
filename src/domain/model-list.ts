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

/** The selected model classifies existing values. */
export function classificationTarget(settings: AutoClassifierSettings): ModelTarget | undefined {
	return findModelTarget(settings.providers, settings.selectedProvider, settings.selectedModel);
}

/** Decision models cannot write free text, so tag generation falls back to the first chat model. */
export function generationTarget(settings: AutoClassifierSettings): ModelTarget | undefined {
	const selected = classificationTarget(settings);
	if (selected && decisionTransport(selected.provider.name, selected.model) === 'chat')
		return selected;
	for (const provider of settings.providers) {
		if (!providerHasAuth(provider)) continue;
		const model = provider.models.find((item) => decisionTransport(provider.name, item) === 'chat');
		const target = model && findModelTarget(settings.providers, provider.name, model.id);
		if (target) return target;
	}
	return undefined;
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
