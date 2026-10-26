import { App, type TAbstractFile, type TFile, type Vault } from 'obsidian';
import { ClassificationService } from '../../src/ui/ClassificationService';
import type { AutoClassifierSettings, FrontmatterField, ProviderConfig } from '../../src/types';
import { getFieldValues } from '../../src/ui/frontmatter';
import { findUniqueProvider, PROVIDER_NAMES } from '../../src/utils/lib-utils';
import type { PluginNotices } from '../../src/ui/plugin-notices';
import { createTestTFile } from '../helpers/obsidian-fixtures';
import type { Mock } from 'vitest';

const mocks = vi.hoisted(() => ({
	classify: vi.fn(),
	generate: vi.fn(),
}));

vi.mock('obsidian', async (importOriginal) => importOriginal<typeof import('obsidian')>());

vi.mock('../../src/ui/JevClassifier', () => ({
	JevClassifier: class {
		classify(...args: unknown[]) {
			return mocks.classify(...args);
		}
	},
	JevClassificationError: class extends Error {
		code = 'invalid-response';
	},
}));

vi.mock('../../src/ui/provider-api', () => ({
	generateTags: (...args: unknown[]) => mocks.generate(...args),
}));

vi.mock('../../src/ui/frontmatter', () => ({
	getFieldValues: vi.fn(),
}));

const CONTENT = '---\nother: keep\n---\nBody text\n';

type MockedVault = {
	cachedRead: Mock<Vault['cachedRead']>;
	getAbstractFileByPath: Mock<(path: string) => TAbstractFile | null>;
	process: Mock<Vault['process']>;
};

type MockedApp = App & { vault: MockedVault };

function mockedVault(app: App): MockedVault {
	return app.vault as unknown as MockedVault;
}

function requireValue<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Expected ${label} to exist`);
	return value;
}

function makeField(overrides: Partial<FrontmatterField> = {}): FrontmatterField {
	return {
		id: 9,
		name: 'category',
		refs: ['alpha', 'beta'],
		count: { min: 1, max: 2 },
		overwrite: false,
		linkType: 'Normal',
		customQuery: 'field instructions',
		...overrides,
	};
}

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		name: 'OpenAI',
		baseUrl: 'https://provider.invalid',
		models: [{ id: 'model-1', name: 'Model 1' }],
		temperature: 0.2,
		auth: { type: 'apiKey', apiKey: 'provider-secret' },
		...overrides,
	};
}

describe('ClassificationService', () => {
	let app: MockedApp;
	let vault: MockedVault;
	let file: TFile;
	let settings: AutoClassifierSettings;
	let service: ClassificationService;
	let active: boolean;
	let currentContent: string;
	let written: string[];
	let beforeProcess: (() => void) | undefined;
	let saveSettings: Mock<() => Promise<void>>;
	let show: Mock<PluginNotices['show']>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		active = true;
		currentContent = CONTENT;
		written = [];
		beforeProcess = undefined;
		file = createTestTFile('notes/current.md', 'current');
		const nativeApp = new App();
		vault = mockedVault(nativeApp);
		vault.cachedRead = vi.fn<Vault['cachedRead']>().mockResolvedValue(CONTENT);
		vault.getAbstractFileByPath = vi.fn<(path: string) => TAbstractFile | null>((path) =>
			path === file.path ? file : null
		);
		vault.process = vi.fn<Vault['process']>(async (_file, transform) => {
			beforeProcess?.();
			const result = transform(currentContent);
			written.push(result);
			return result;
		});
		app = nativeApp as unknown as MockedApp;
		settings = {
			classificationRule: 'global instructions',
			frontmatter: [makeField()],
			providers: [],
			selectedProvider: '',
			selectedModel: '',
			jev: { apiKey: 'jev-secret', model: 'jev-model' },
		};
		saveSettings = vi.fn<() => Promise<void>>(async () => undefined);
		show = vi.fn<PluginNotices['show']>(() => null);
		const notices: Pick<PluginNotices, 'show'> = { show };
		service = new ClassificationService({
			app,
			getSettings: () => settings,
			isActive: () => active,
			saveSettings,
			notices: notices as unknown as PluginNotices,
		});
		vi.mocked(getFieldValues).mockReturnValue([]);
		mocks.classify.mockResolvedValue({ status: 'selected', values: ['alpha'] });
		mocks.generate.mockResolvedValue(['fresh-tag']);
	});

	it('finds only one exact provider-name match', () => {
		const exact = makeProvider({ name: 'Exact name' });
		expect(findUniqueProvider([exact], 'Exact name')).toBe(exact);
		expect(findUniqueProvider([exact], 'exact name')).toBeUndefined();
		expect(findUniqueProvider([exact], 'Exact name ')).toBeUndefined();
		expect(findUniqueProvider([], 'Exact name')).toBeUndefined();
		expect(findUniqueProvider([exact, makeProvider({ name: 'Exact name' })], 'Exact name')).toBe(
			undefined
		);
	});

	it('does not revive a deactivated service when the plugin becomes active again', async () => {
		active = false;
		service.deactivate();
		active = true;
		await service.classify(file, 9);
		expect(mocks.classify).not.toHaveBeenCalled();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).not.toHaveBeenCalled();
	});

	it.each(['', '   ', 'bad\nkey'])(
		'rejects invalid field name %j before preparing references',
		async (name) => {
			settings.frontmatter = [makeField({ name, refs: [] })];
			await service.classify(file, 9);
			expect(getFieldValues).not.toHaveBeenCalled();
			expect(saveSettings).not.toHaveBeenCalled();
			expect(mocks.classify).not.toHaveBeenCalled();
			expect(app.vault.process).not.toHaveBeenCalled();
		}
	);

	it.each(['Ollama', 'LM Studio'])('allows documented keyless %s generation', async (name) => {
		settings.frontmatter = [makeField({ name: 'tags', refs: [], generateNewTags: true })];
		settings.providers = [makeProvider({ name, auth: { type: 'apiKey', apiKey: '' } })];
		settings.selectedProvider = name;
		settings.selectedModel = 'model-1';
		await service.classify(file, 9);
		expect(mocks.classify).not.toHaveBeenCalled();
		expect(mocks.generate).toHaveBeenCalledOnce();
		expect(app.vault.process).toHaveBeenCalledOnce();
	});

	it('uses Jev for references without requiring provider, model, or LLM authentication', async () => {
		await service.classify(file, 9);

		expect(mocks.classify).toHaveBeenCalledOnce();
		const classifyCall = requireValue(mocks.classify.mock.calls[0], 'Jev classification call');
		expect(classifyCall[0]).toMatchObject({
			fieldName: 'category',
			instructions: 'global instructions\n\nfield instructions',
			candidates: ['alpha', 'beta'],
			max: 2,
		});
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(vault.process).toHaveBeenCalledOnce();
		expect(requireValue(written[0], 'written frontmatter')).toContain('category: [alpha]');
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Classification completed.',
		});
	});

	it('ignores a raw generation flag on ordinary fields', async () => {
		settings.frontmatter[0] = makeField({ generateNewTags: true });

		await service.classify(file, 9);

		expect(mocks.classify).toHaveBeenCalledOnce();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).toHaveBeenCalledOnce();
	});

	it('requires the exact raw boolean opt-in on the exact tags field', async () => {
		const field = makeField({ name: 'tags', refs: [] });
		Reflect.set(field, 'generateNewTags', 'true');
		settings.frontmatter[0] = field;

		await service.classify(file, 9);

		expect(mocks.classify).not.toHaveBeenCalled();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_setup', {
			message: 'No usable reference values were found. No changes were made.',
		});
	});

	it('does not call Jev for empty tags references and only generates when the exact tags opt-in is true', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', refs: [], generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		currentContent = '---\ntags: [old-tag]\n---\nBody text\n';
		vault.cachedRead.mockResolvedValue(currentContent);
		vi.mocked(getFieldValues).mockReturnValue([]);

		await service.classify(file, 9);

		expect(getFieldValues).toHaveBeenCalledWith('tags', expect.any(Array), app.metadataCache);
		expect(saveSettings).not.toHaveBeenCalled();
		expect(mocks.classify).not.toHaveBeenCalled();
		expect(mocks.generate).toHaveBeenCalledOnce();
		const generationCall = requireValue(mocks.generate.mock.calls[0], 'tag generation call');
		expect(generationCall[0]).toMatchObject({
			fieldName: 'tags',
			enabled: true,
			excluded: ['old-tag'],
			minimum: 1,
			maximum: 2,
		});
		expect(vault.process).toHaveBeenCalledOnce();
		expect(requireValue(written[0], 'written frontmatter')).toContain('fresh-tag');
	});

	it('rejects generation for duplicate exact provider names before making a provider request', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', refs: ['   '], generateNewTags: true });
		const first = makeProvider({
			name: 'Duplicate provider',
			baseUrl: 'https://first.invalid',
			auth: { type: 'apiKey', apiKey: 'first-profile-key' },
		});
		const second = makeProvider({
			name: 'Duplicate provider',
			baseUrl: 'https://second.invalid',
			auth: { type: 'apiKey', apiKey: 'second-profile-key' },
		});
		settings.providers = [first, second];
		settings.selectedProvider = 'Duplicate provider';
		settings.selectedModel = 'model-1';

		await service.classify(file, 9);

		expect(mocks.generate).not.toHaveBeenCalled();
		expect(mocks.classify).not.toHaveBeenCalled();
		expect(saveSettings).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(first).toMatchObject({
			name: 'Duplicate provider',
			baseUrl: 'https://first.invalid',
			auth: { type: 'apiKey', apiKey: 'first-profile-key' },
		});
		expect(second).toMatchObject({
			name: 'Duplicate provider',
			baseUrl: 'https://second.invalid',
			auth: { type: 'apiKey', apiKey: 'second-profile-key' },
		});
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'New tags could not be generated safely. No changes were made.',
		});
	});

	it('does not run either provider or commit when references are absent and generation is disabled', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', refs: [], generateNewTags: false });

		await service.classify(file, 9);

		expect(mocks.classify).not.toHaveBeenCalled();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_setup', {
			message: 'No usable reference values were found. No changes were made.',
		});
	});

	it('keeps a no-candidates response distinct from a confident all-no result', async () => {
		mocks.classify.mockResolvedValue({ status: 'no-candidates' });

		await service.classify(file, 9);

		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_setup', {
			message: 'No usable reference values were found. No changes were made.',
		});
	});

	it('uses the tags opt-in to generate after Jev reports no usable candidates', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.classify.mockResolvedValue({ status: 'no-candidates' });

		await service.classify(file, 9);

		expect(mocks.generate).toHaveBeenCalledOnce();
		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(requireValue(written[0], 'written frontmatter')).toContain('fresh-tag');
	});

	it('does not generate or commit an all-no result for a non-opted-in field', async () => {
		mocks.classify.mockResolvedValue({ status: 'empty', values: [] });

		await service.classify(file, 9);

		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'No matching references were selected. No changes were made.',
		});
	});

	it('does not generate or commit after an invalid Jev result', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.classify.mockResolvedValue({ status: 'invalid', error: { code: 'invalid-input' } });

		await service.classify(file, 9);

		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Classification could not be completed safely. No changes were made.',
		});
	});

	it('allows generation after an all-no result only for opted-in tags', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.classify.mockResolvedValue({ status: 'empty', values: [] });

		await service.classify(file, 9);

		expect(mocks.generate).toHaveBeenCalledOnce();
		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(requireValue(written[0], 'written frontmatter')).toContain('fresh-tag');
	});

	it('does not generate or commit when any candidate abstains', async () => {
		mocks.classify.mockResolvedValue({ status: 'abstain' });
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';

		await service.classify(file, 9);

		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Classification was uncertain. No changes were made.',
		});
	});

	it('does not inspect provider settings when no generated slots remain', async () => {
		settings.frontmatter[0] = makeField({
			name: 'tags',
			count: { min: 1, max: 1 },
			generateNewTags: true,
		});

		await service.classify(file, 9);

		expect(mocks.classify).toHaveBeenCalledOnce();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).toHaveBeenCalledOnce();
	});

	it('bounds generated tags by the remaining combined minimum and maximum', async () => {
		settings.frontmatter[0] = makeField({
			name: 'tags',
			count: { min: 2, max: 2 },
			generateNewTags: true,
		});
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';

		await service.classify(file, 9);

		const generationCall = requireValue(mocks.generate.mock.calls[0], 'tag generation call');
		expect(generationCall[0]).toMatchObject({
			minimum: 1,
			maximum: 1,
			excluded: ['alpha', 'beta'],
		});
		const writtenContent = requireValue(written[0], 'written frontmatter');
		expect(writtenContent).toContain('tags:');
		expect(writtenContent).toContain('alpha');
		expect(writtenContent).toContain('fresh-tag');
	});

	it('does not write a selection that leaves the combined operation below its minimum', async () => {
		settings.frontmatter[0] = makeField({
			count: { min: 2, max: 2 },
			name: 'tags',
			generateNewTags: true,
		});
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.generate.mockResolvedValue([]);

		await service.classify(file, 9);

		const generationCall = requireValue(mocks.generate.mock.calls[0], 'tag generation call');
		expect(generationCall[0]).toMatchObject({ minimum: 1, maximum: 1 });
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'The selected values did not meet the minimum. No changes were made.',
		});
	});

	it('does not commit confident selections when required tag generation fails', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.generate.mockRejectedValue(new Error('private provider error'));

		await service.classify(file, 9);

		expect(mocks.classify).toHaveBeenCalledOnce();
		expect(mocks.generate).toHaveBeenCalledOnce();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'New tags could not be generated safely. No changes were made.',
		});
	});

	it('uses one atomic callback and rejects revoked settings at the callback boundary', async () => {
		beforeProcess = () => {
			requireValue(settings.frontmatter[0], 'current frontmatter field').name = 'renamed';
		};

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('rechecks the Jev configuration inside the final native callback', async () => {
		beforeProcess = () => {
			settings.jev.model = 'user-changed-model';
		};

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('rechecks the selected provider and model inside the final native callback', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		beforeProcess = () => {
			settings.selectedModel = 'model-2';
		};

		await service.classify(file, 9);

		expect(mocks.generate).toHaveBeenCalledOnce();
		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('rechecks the pinned file path inside the final native callback', async () => {
		beforeProcess = () => {
			file.path = 'notes/renamed.md';
		};

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('rejects a different file object returned for the pinned path inside the callback', async () => {
		const replacement = { ...file };
		beforeProcess = () => {
			vault.getAbstractFileByPath.mockReturnValue(replacement);
		};

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('revokes a pending write when the service unloads inside the native callback', async () => {
		beforeProcess = () => {
			active = false;
			service.deactivate();
		};

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).not.toHaveBeenCalled();
	});

	it('allows unrelated setting and note changes while preserving the live unrelated content', async () => {
		settings.frontmatter.push(makeField({ id: 10, name: 'other', refs: ['x'] }));
		beforeProcess = () => {
			requireValue(settings.frontmatter[1], 'unrelated frontmatter field').customQuery =
				'unrelated user edit';
			currentContent = '---\nother: updated\n---\nBody text\n';
		};

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		const writtenContent = requireValue(written[0], 'written frontmatter');
		expect(writtenContent).toContain('other: updated');
		expect(writtenContent).toContain('category: [alpha]');
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Classification completed.',
		});
	});

	it('aborts prepared references if field semantics change during collection', async () => {
		settings.frontmatter[0] = makeField({ refs: [] });
		vi.mocked(getFieldValues).mockImplementation(() => {
			requireValue(settings.frontmatter[0], 'current frontmatter field').customQuery =
				'externally changed';
			return ['collected'];
		});

		await service.classify(file, 9);

		expect(requireValue(settings.frontmatter[0], 'current frontmatter field').customQuery).toBe(
			'externally changed'
		);
		expect(saveSettings).not.toHaveBeenCalled();
		expect(mocks.classify).not.toHaveBeenCalled();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
	});

	it('uses folder references for this run without persisting them', async () => {
		settings.frontmatter[0] = makeField({ refs: [] });
		vi.mocked(getFieldValues).mockReturnValue(['collected-one', 'collected-two']);

		await service.classify(file, 9);

		expect(saveSettings).not.toHaveBeenCalled();
		expect(requireValue(settings.frontmatter[0], 'current frontmatter field').refs).toEqual([]);
		const classifyCall = requireValue(mocks.classify.mock.calls[0], 'Jev classification call');
		expect(classifyCall[0].candidates).toEqual(['collected-one', 'collected-two']);
		expect(app.vault.process).toHaveBeenCalledOnce();
	});

	it('derives candidates per folder and leaves settings untouched across runs', async () => {
		settings.frontmatter[0] = makeField({ refs: [] });
		const before = JSON.stringify(settings);
		vi.mocked(getFieldValues)
			.mockReturnValueOnce(['folder-a'])
			.mockReturnValueOnce(['folder-b']);

		await service.classify(file, 9);
		await service.classify(file, 9);

		const candidates = mocks.classify.mock.calls.map((call) => call[0].candidates);
		expect(candidates).toEqual([['folder-a'], ['folder-b']]);
		expect(JSON.stringify(settings)).toBe(before);
		expect(saveSettings).not.toHaveBeenCalled();
	});

	it('reuses the Jev configuration guard while generation is pending', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.generate.mockImplementation(async (input: { assertCurrent: () => void }) => {
			settings.jev.model = 'changed-model';
			input.assertCurrent();
			return ['fresh-tag'];
		});

		await service.classify(file, 9);

		expect(app.vault.process).not.toHaveBeenCalled();
		expect(settings.jev.model).toBe('changed-model');
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('rejects work after the pinned file is renamed', async () => {
		let finish: ((result: { status: 'selected'; values: string[] }) => void) | undefined;
		mocks.classify.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		const pending = service.classify(file, 9);
		await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledOnce());
		file.path = 'notes/renamed.md';
		requireValue(finish, 'classifier completion callback')({
			status: 'selected',
			values: ['alpha'],
		});
		await pending;

		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('rejects work when the pinned file is removed during inference', async () => {
		let finish: ((result: { status: 'selected'; values: string[] }) => void) | undefined;
		mocks.classify.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		const pending = service.classify(file, 9);
		await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledOnce());
		settings.frontmatter = [];
		requireValue(finish, 'classifier completion callback')({
			status: 'selected',
			values: ['alpha'],
		});
		await pending;

		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('expires the shared operation deadline inside the final native callback', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
		beforeProcess = () => now.mockReturnValue(61_000);

		await service.classify(file, 9);

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(written).toHaveLength(0);
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Classification timed out. No changes were made.',
		});
	});

	it('revokes active work on unload and does not report after deactivation', async () => {
		let finish: ((result: { status: 'selected'; values: string[] }) => void) | undefined;
		mocks.classify.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		const pending = service.classify(file, 9);
		await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledOnce());
		active = false;
		service.deactivate();
		requireValue(finish, 'classifier completion callback')({
			status: 'selected',
			values: ['alpha'],
		});
		await pending;

		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).not.toHaveBeenCalled();
	});

	it('shares a per-file-field lock while allowing another field to proceed', async () => {
		settings.frontmatter.push(makeField({ id: 10, name: 'other', refs: ['x'] }));
		const finish: Array<(result: { status: 'selected'; values: string[] }) => void> = [];
		mocks.classify.mockImplementation(
			() =>
				new Promise<{ status: 'selected'; values: string[] }>((resolve) => {
					finish.push((result) => resolve(result));
				})
		);
		const first = service.classify(file, 9);
		await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledOnce());
		await service.classify(file, 9);
		const other = service.classify(file, 10);
		await vi.waitFor(() => expect(mocks.classify).toHaveBeenCalledTimes(2));
		requireValue(finish[0], 'first classifier completion callback')({
			status: 'selected',
			values: ['alpha'],
		});
		requireValue(finish[1], 'second classifier completion callback')({
			status: 'selected',
			values: ['x'],
		});
		await Promise.all([first, other]);

		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Classification is already running for this field.',
		});
		expect(app.vault.process).toHaveBeenCalledTimes(2);
	});

	it('rejects a user provider change during tag generation rather than treating it as OAuth refresh', async () => {
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [makeProvider()];
		const provider = requireValue(settings.providers[0], 'configured provider');
		settings.selectedProvider = 'OpenAI';
		settings.selectedModel = 'model-1';
		mocks.generate.mockImplementation(async (input: { assertCurrent: () => void }) => {
			provider.auth = { type: 'apiKey', apiKey: 'user-replaced-key' };
			input.assertCurrent();
			return ['fresh-tag'];
		});

		await service.classify(file, 9);

		expect(provider.auth).toEqual({ type: 'apiKey', apiKey: 'user-replaced-key' });
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('classification_status', {
			message: 'Settings or note content changed. No changes were made.',
		});
	});

	it('awaits and safely persists an expected OAuth refresh', async () => {
		const tokens = {
			accessToken: 'old-access',
			refreshToken: 'refresh',
			expiresAt: 10,
			accountId: 'account',
		};
		settings.frontmatter[0] = makeField({ name: 'tags', generateNewTags: true });
		settings.providers = [
			makeProvider({
				name: PROVIDER_NAMES.CODEX,
				auth: { type: 'oauth', oauth: tokens },
			}),
		];
		const provider = requireValue(settings.providers[0], 'OAuth provider');
		settings.selectedProvider = provider.name;
		settings.selectedModel = 'model-1';
		mocks.generate.mockImplementation(async (_input, _provider, _model, refresh) => {
			await refresh({ ...tokens, accessToken: 'new-access' });
			return ['fresh-tag'];
		});

		await service.classify(file, 9);

		expect(saveSettings).toHaveBeenCalledOnce();
		expect(provider.auth).toMatchObject({
			type: 'oauth',
			oauth: { accessToken: 'new-access' },
		});
		expect(app.vault.process).toHaveBeenCalledOnce();
	});
});
