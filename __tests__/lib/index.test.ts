import {
	generateId,
	getProviderPreset,
	findMatchingPreset,
} from '../../src/utils/lib-utils';

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

// -------------------- findMatchingPreset Tests --------------------
describe('findMatchingPreset', () => {
	test('matches provider by exact baseUrl', () => {
		const config = {
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			name: 'SomeOtherName',
		};

		const result = findMatchingPreset(config);
		expect(result).toBe('OpenAI');
	});

	test('matches provider by exact name', () => {
		const config = {
			baseUrl: 'https://some-other-url.com',
			name: 'Anthropic',
		};

		const result = findMatchingPreset(config);
		expect(result).toBe('Anthropic');
	});

	test('prioritizes baseUrl match over name match', () => {
		const config = {
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			name: 'Anthropic',
		};

		const result = findMatchingPreset(config);
		expect(result).toBe('OpenAI');
	});

	test('returns "Custom Provider" when no match found', () => {
		expect(findMatchingPreset({ baseUrl: '', name: '' })).toBe('Custom Provider');
		expect(findMatchingPreset({ baseUrl: 'https://custom.com', name: 'UnknownProvider' })).toBe('Custom Provider');
		expect(findMatchingPreset({ baseUrl: 'https://custom.com', name: 'openai' })).toBe('Custom Provider');
		expect(findMatchingPreset({ baseUrl: 'https://api.openai.com/v1/chat', name: 'Test' })).toBe('Custom Provider');
	});
});
