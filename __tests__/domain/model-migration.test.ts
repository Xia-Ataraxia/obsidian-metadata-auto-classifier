import { migrateRetiredModels } from '../../src/domain/model-migration';
import type { ProviderConfig } from '../../src/types';

const provider = (name: string, ...ids: string[]): ProviderConfig => ({
	name,
	baseUrl: 'https://provider.invalid',
	models: ids.map((id) => ({ id, name: id })),
});

describe('migrateRetiredModels', () => {
	test('replaces a retired preset, keeps its position and moves the selection', () => {
		const settings = {
			providers: [provider('OpenAI', 'gpt-4.1-mini', 'my-finetune')],
			selectedProvider: 'OpenAI',
			selectedModel: 'gpt-4.1-mini',
		};
		const migrated = migrateRetiredModels(settings);
		expect(migrated).toEqual([{ provider: 'OpenAI', from: 'gpt-4.1-mini', to: 'gpt-6.1-terra' }]);
		expect(settings.providers[0]?.models.map((model) => model.id)).toEqual(['gpt-6.1-terra', 'my-finetune']);
		expect(settings.providers[0]?.models[0]?.name).toBe('GPT-6.1 Terra');
		expect(settings.selectedModel).toBe('gpt-6.1-terra');
	});

	test('does not duplicate a successor the user already has', () => {
		const settings = {
			providers: [provider('OpenAI', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-6.1-terra')],
			selectedProvider: '',
			selectedModel: '',
		};
		migrateRetiredModels(settings);
		expect(settings.providers[0]?.models.map((model) => model.id)).toEqual(['gpt-6.1-terra']);
	});

	test('keeps the decision flag of the successor preset', () => {
		const settings = {
			providers: [provider('OpenRouter', 'typesafe/jev-1.14')],
			selectedProvider: '',
			selectedModel: '',
		};
		migrateRetiredModels(settings);
		expect(settings.providers[0]?.models[0]).toMatchObject({ id: 'typesafe/jev-router', decision: true });
	});

	test('leaves custom ids, local providers and same-named ids elsewhere alone', () => {
		const settings = {
			providers: [
				provider('Ollama', 'llama3.1'),
				provider('My Endpoint', 'gpt-4.1'),
				provider('Anthropic', 'claude-opus-4-8'),
			],
			selectedProvider: '',
			selectedModel: '',
		};
		expect(migrateRetiredModels(settings)).toEqual([]);
	});
});
