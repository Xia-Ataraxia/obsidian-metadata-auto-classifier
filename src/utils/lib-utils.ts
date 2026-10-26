import type { FrontmatterField, ProviderConfig, ProviderPreset } from '../types';
import providerPresetsData from '../domain/presets.json';

export const PROVIDER_NAMES = {
	OPENAI: providerPresetsData.openai.name,
	ANTHROPIC: providerPresetsData.anthropic.name,
	OPENROUTER: providerPresetsData.openrouter.name,
	GEMINI: providerPresetsData.gemini.name,
	DEEPSEEK: providerPresetsData.deepseek.name,
	LMSTUDIO: providerPresetsData.lmstudio.name,
	OLLAMA: providerPresetsData.ollama.name,
	CODEX: providerPresetsData.codex.name,
	CUSTOM: providerPresetsData.custom.name,
} as const;

export const generateId = (): number => {
	return Date.now();
};

/**
 * Get all provider presets with type safety
 * Excludes the version field and returns only valid ProviderPreset objects
 */
export const getProviderPresets = (): ProviderPreset[] => {
	return Object.values(providerPresetsData) as unknown as ProviderPreset[];
};

/**
 * Get a specific provider preset by name
 */
export const getProviderPreset = (providerName: string): ProviderPreset => {
	const presets = getProviderPresets();
	const preset = presets.find((p) => p.name === providerName);
	if (!preset) {
		throw new Error(`Provider preset not found: ${providerName}`);
	}
	return preset;
};

export function findUniqueProvider(
	providers: ReadonlyArray<ProviderConfig>,
	name: string
): ProviderConfig | undefined {
	let match: ProviderConfig | undefined;
	for (const provider of providers) {
		if (provider.name !== name) continue;
		if (match) return undefined;
		match = provider;
	}
	return match;
}

/**
 * Writes an edited clone back into the settings list by id (the editor modal works on a copy).
 */
export function replaceFrontmatterById(
	list: FrontmatterField[],
	updated: FrontmatterField
): FrontmatterField[] {
	return list.map((field) => (field.id === updated.id ? updated : field));
}
