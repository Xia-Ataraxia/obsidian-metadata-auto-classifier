import type { Model, ProviderConfig } from '../types';

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
