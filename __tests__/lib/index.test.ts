import { generateId, getProviderPreset, findUniqueProvider } from 'lib';
import type { ProviderConfig } from '../../src/types';

// -------------------- generateId Tests --------------------
describe('generateId', () => {
	test('generates unique IDs based on timestamp', async () => {
		const id1 = generateId();
		await new Promise((resolve) => setTimeout(resolve, 10));
		const id2 = generateId();

		expect(id2).toBeGreaterThan(id1);
	});
});

// -------------------- getProviderPreset Tests --------------------
describe('getProviderPreset', () => {
	test('returns correct preset for valid provider name', () => {
		const preset = getProviderPreset('OpenAI');

		expect(preset.name).toBe('OpenAI');
		expect(preset.baseUrl).toBe('https://api.openai.com/v1/chat/completions');
		expect(preset.apiKeyRequired).toBe(true);
	});

	test('throws error when provider name does not exist', () => {
		expect(() => getProviderPreset('NonExistentProvider')).toThrow(
			'Provider preset not found: NonExistentProvider'
		);
	});

	test('throws error for case-sensitive provider names', () => {
		expect(() => getProviderPreset('openai')).toThrow(/Provider preset not found/);
	});
});

describe('findUniqueProvider', () => {
	const provider = (name: string, baseUrl = 'https://example.invalid'): ProviderConfig => ({
		name,
		baseUrl,
		models: [],
	});

	test('returns the exact configured object without rewriting its endpoint', () => {
		const first = provider('Anthropic');
		const selected = provider('OpenAI', 'https://custom.example.invalid');
		const providers = [first, selected];
		expect(findUniqueProvider(providers, 'OpenAI')).toBe(selected);
		expect(providers).toEqual([first, selected]);
	});

	test('does not infer a backend from the endpoint or normalize the name', () => {
		const configured = provider('Alias', 'https://api.openai.com/v1/chat/completions');
		expect(findUniqueProvider([configured], 'OpenAI')).toBeUndefined();
		expect(findUniqueProvider([provider('OpenAI')], 'openai')).toBeUndefined();
		expect(findUniqueProvider([], 'OpenAI')).toBeUndefined();
	});

	test('rejects duplicate names regardless of order or differing endpoints', () => {
		const first = provider('OpenAI', 'https://first.example.invalid');
		const second = provider('OpenAI', 'https://second.example.invalid');
		expect(findUniqueProvider([first, second], 'OpenAI')).toBeUndefined();
		expect(findUniqueProvider([second, first], 'OpenAI')).toBeUndefined();
	});

	test('rejects a repeated object instead of silently choosing its first occurrence', () => {
		const configured = provider('OpenAI');
		expect(findUniqueProvider([configured, configured], 'OpenAI')).toBeUndefined();
	});
});
