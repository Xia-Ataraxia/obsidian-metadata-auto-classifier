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

/**
 * Find matching preset for an existing provider config
 * Matches by baseUrl or name
 */
export const findMatchingPreset = (providerConfig: { baseUrl: string; name: string }): string => {
	const presets = getProviderPresets();
	const matchingPreset = presets.find(
		(preset) => preset.baseUrl === providerConfig.baseUrl || preset.name === providerConfig.name
	);
	return matchingPreset?.name || 'Custom Provider';
};

/**
 * Whether the provider can be called: credentials are present, or its preset needs none (Ollama, LM Studio).
 * Supports both the unified auth field and legacy apiKey/oauth fields.
 */
export const hasValidAuth = (provider: ProviderConfig): boolean => {
	if (provider.auth?.type === 'oauth' || (!provider.auth && provider.authType === 'oauth')) {
		return Boolean(provider.auth?.type === 'oauth' ? provider.auth.oauth?.accessToken : provider.oauth?.accessToken);
	}
	const apiKey = provider.auth?.type === 'apiKey' ? provider.auth.apiKey : provider.apiKey;
	if (apiKey) return true;
	return getProviderPresets().find((p) => p.name === provider.name)?.apiKeyRequired === false;
};

 * Writes an edited clone back into the settings list by id (the editor modal works on a copy).
 */
export function replaceFrontmatterById(list: FrontmatterField[], updated: FrontmatterField): FrontmatterField[] {
	return list.map((f) => (f.id === updated.id ? updated : f));
}
