import { isDuplicateModel, saveModel } from '../../src/domain/model-list';
import type { ProviderConfig } from '../../src/types';

const providers = (): ProviderConfig[] =>
	[
		{ name: 'OpenAI', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
		{ name: 'Fake', models: [{ id: 'f', name: 'F' }] },
	] as ProviderConfig[];

describe('saveModel', () => {
	it('edits in place and keeps another selected model', () => {
		const list = providers();
		const selection = { selectedProvider: 'Fake', selectedModel: 'f' };
		saveModel(list, selection, 'OpenAI', { id: 'a2', name: 'A2' }, { provider: 'OpenAI', model: 'a' });
		expect(list[0]!.models.map((m) => m.id)).toEqual(['a2', 'b']);
		expect(selection).toEqual({ selectedProvider: 'Fake', selectedModel: 'f' });
	});

	it('follows the selection when the selected model is edited or moved', () => {
		const list = providers();
		const selection = { selectedProvider: 'OpenAI', selectedModel: 'b' };
		saveModel(list, selection, 'Fake', { id: 'b', name: 'B' }, { provider: 'OpenAI', model: 'b' });
		expect(list[0]!.models.map((m) => m.id)).toEqual(['a']);
		expect(list[1]!.models.map((m) => m.id)).toEqual(['f', 'b']);
		expect(selection).toEqual({ selectedProvider: 'Fake', selectedModel: 'b' });
	});

	it('appends on add', () => {
		const list = providers();
		saveModel(list, { selectedProvider: '', selectedModel: '' }, 'Fake', { id: 'g', name: 'G' });
		expect(list[1]!.models.map((m) => m.id)).toEqual(['f', 'g']);
	});
});

describe('isDuplicateModel', () => {
	it('flags an existing id on the same provider only', () => {
		expect(isDuplicateModel(providers(), 'OpenAI', 'a')).toBe(true);
		expect(isDuplicateModel(providers(), 'Fake', 'a')).toBe(false);
	});

	it('ignores the model being edited', () => {
		expect(isDuplicateModel(providers(), 'OpenAI', 'a', { provider: 'OpenAI', model: 'a' })).toBe(false);
		expect(isDuplicateModel(providers(), 'OpenAI', 'b', { provider: 'OpenAI', model: 'a' })).toBe(true);
	});
});
