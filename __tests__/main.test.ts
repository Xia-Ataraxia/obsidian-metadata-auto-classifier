import { App, type TFile } from 'obsidian';
import AutoClassifierPlugin from '../src/main';
import { DEFAULT_SETTINGS, NOTICE_CATALOG } from '../src/domain/constants';
import { Notice } from '../src/ui/settings/components/Notice';
import type {
	FrontmatterField,
	OAuthTokens,
	ProviderConfig,
	PluginNoticesHost,
} from '../src/types';
import { createTestTFile, TEST_PLUGIN_MANIFEST } from './helpers/obsidian-fixtures';

const mocks = vi.hoisted(() => ({
	classify: vi.fn(),
	deactivate: vi.fn(),
	classificationContexts: [] as unknown[],
	noticeHosts: [] as unknown[],
	settingTabPlugins: [] as unknown[],
	noticeArguments: [] as Array<[PluginNoticesHost, typeof NOTICE_CATALOG, string]>,
	noticeShow: vi.fn(),
	noticeUnload: vi.fn(),
	loggerInfo: vi.fn(),
	loggerError: vi.fn(),
}));

vi.mock('obsidian', async (importOriginal) => importOriginal<typeof import('obsidian')>());

vi.mock('../src/ui/ClassificationService', () => ({
	ClassificationService: class {
		constructor(context: unknown) {
			mocks.classificationContexts.push(context);
		}

		classify(...args: unknown[]) {
			return mocks.classify(...args);
		}

		deactivate() {
			mocks.deactivate();
		}
	},
}));

vi.mock('../src/ui/settings', () => ({
	AutoClassifierSettingTab: class {
		constructor(plugin: unknown) {
			mocks.settingTabPlugins.push(plugin);
		}
	},
}));

vi.mock('../src/ui/settings/components/Notice', () => ({
	Notice: class {
		static head = '';
	},
}));

vi.mock('../src/ui/plugin-notices', () => ({
	PluginNotices: class {
		constructor(host: PluginNoticesHost, catalog: typeof NOTICE_CATALOG, head: string) {
			mocks.noticeHosts.push(host);
			mocks.noticeArguments.push([host, catalog, head]);
		}

		show(...args: unknown[]) {
			return mocks.noticeShow(...args);
		}

		unload() {
			mocks.noticeUnload();
		}
	},
}));

vi.mock('../src/utils/plugin-logger', () => ({
	PluginLogger: class {
		info(...args: unknown[]) {
			mocks.loggerInfo(...args);
		}

		error(...args: unknown[]) {
			mocks.loggerError(...args);
		}
	},
}));

function makeField(id: number): FrontmatterField {
	return {
		id,
		name: `field-${id}`,
		refs: ['reference'],
		count: { min: 1, max: 1 },
		overwrite: false,
		linkType: 'Normal',
		customQuery: '',
	};
}

function requireValue<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Expected ${label} to exist`);
	return value;
}

describe('AutoClassifierPlugin', () => {
	let app: App;
	let plugin: AutoClassifierPlugin;

	function installClassificationService(): void {
		Reflect.set(plugin, 'classificationService', {
			classify: (file: TFile, id: number) => mocks.classify(file, id),
			deactivate: () => mocks.deactivate(),
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.classificationContexts.length = 0;
		mocks.noticeHosts.length = 0;
		mocks.noticeArguments.length = 0;
		mocks.settingTabPlugins.length = 0;
		mocks.classify.mockReset().mockResolvedValue(undefined);
		mocks.deactivate.mockReset();
		mocks.noticeShow.mockReset();
		mocks.noticeUnload.mockReset();
		mocks.loggerInfo.mockReset();
		mocks.loggerError.mockReset();

		app = new App();
		plugin = new AutoClassifierPlugin(app, TEST_PLUGIN_MANIFEST);
		plugin.settings = {
			...DEFAULT_SETTINGS,
			jev: { ...DEFAULT_SETTINGS.jev },
			providers: [],
			frontmatter: [makeField(1)],
			classificationRule: 'synthetic instructions',
		};
		const notices: Pick<AutoClassifierPlugin['notices'], 'show' | 'unload'> = {
			show: mocks.noticeShow,
			unload: mocks.noticeUnload,
		};
		plugin.notices = notices as unknown as AutoClassifierPlugin['notices'];
		const logger: Pick<AutoClassifierPlugin['logger'], 'info' | 'error'> = {
			info: mocks.loggerInfo,
			error: mocks.loggerError,
		};
		plugin.logger = logger as unknown as AutoClassifierPlugin['logger'];
	});

	describe('settings persistence', () => {
		it('merges stored settings with Jev defaults and repairs missing field counts', async () => {
			vi.mocked(plugin.loadData).mockResolvedValue({
				selectedProvider: 'Stored provider',
				jev: { apiKey: 'stored-key' },
				frontmatter: [{ ...makeField(1), count: undefined }],
			});

			await plugin.loadSettings();

			expect(plugin.settings.selectedProvider).toBe('Stored provider');
			expect(plugin.settings.jev).toEqual({
				apiKey: 'stored-key',
				model: DEFAULT_SETTINGS.jev.model,
			});
			expect(requireValue(plugin.settings.frontmatter[0], 'stored frontmatter field').count).toEqual({
				min: 1,
				max: 5,
			});
			expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		});

		it('saves the current settings object', async () => {
			await plugin.saveSettings();

			expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		});
	});

	it('does not publish settings or initialize after unload while loadData is pending', async () => {
		const initialSettings = plugin.settings;
		let resolveLoad: ((settings: unknown) => void) | undefined;
		vi.mocked(plugin.loadData).mockReturnValue(
			new Promise((resolve) => {
				resolveLoad = resolve;
			})
		);

		const pendingOnload = plugin.onload();
		expect(plugin.loadData).toHaveBeenCalledOnce();
		plugin.onunload();
		requireValue(resolveLoad, 'loadData completion callback')({ selectedProvider: 'late settings' });
		await pendingOnload;

		expect(plugin.settings).toBe(initialSettings);
		expect(plugin.settings.selectedProvider).toBe('');
		expect(plugin.saveData).not.toHaveBeenCalled();
		expect(mocks.classificationContexts).toHaveLength(0);
		expect(plugin.addCommand).not.toHaveBeenCalled();
		expect(plugin.addSettingTab).not.toHaveBeenCalled();
	});

	it('does not activate or initialize after unload while saveData is pending', async () => {
		let resolveSave: (() => void) | undefined;
		vi.mocked(plugin.saveData).mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSave = resolve;
				})
		);

		const pendingOnload = plugin.onload();
		await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalledOnce());
		expect(plugin.isActive()).toBe(false);
		plugin.onunload();
		requireValue(resolveSave, 'saveData completion callback')();
		await pendingOnload;

		expect(plugin.isActive()).toBe(false);
		expect(mocks.classificationContexts).toHaveLength(0);
		expect(plugin.addCommand).not.toHaveBeenCalled();
		expect(plugin.addSettingTab).not.toHaveBeenCalled();
	});

	describe('commands', () => {
		it('registers one command per field and the batch command', () => {
			plugin.addCommand = vi.fn();
			plugin.settings.frontmatter = [makeField(1), makeField(2)];

			plugin.setupCommand();

			expect(plugin.addCommand).toHaveBeenCalledTimes(3);
			expect(plugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'fetch-frontmatter-Fetch all frontmatter using current provider',
				})
			);
		});

		it('registers callbacks that invoke their command action', async () => {
			plugin.addCommand = vi.fn();
			const callback = vi.fn().mockResolvedValue(undefined);

			plugin.registerCommand('synthetic', callback);
			const commandCall = requireValue(
				vi.mocked(plugin.addCommand).mock.calls[0],
				'registered command call'
			);
			const command = commandCall[0];
			if (!command.callback) throw new Error('Expected registered command to include a callback');
			await command.callback();

			expect(callback).toHaveBeenCalledOnce();
		});
	});

	it('keeps expired canonical OAuth credentials intact on startup and ordinary classification', async () => {
		const expiredTokens = {
			accessToken: 'stored-expired-token',
			refreshToken: 'stored-refresh-token',
			expiresAt: 1,
			accountId: 'synthetic-account',
		};
		const provider: ProviderConfig = {
			name: 'Codex',
			baseUrl: 'https://provider.invalid',
			models: [{ id: 'model-1', name: 'Model 1' }],
			auth: { type: 'oauth', oauth: expiredTokens },
		};
		vi.mocked(plugin.loadData).mockResolvedValue({
			frontmatter: [makeField(1)],
			providers: [provider],
			selectedProvider: 'Codex',
			selectedModel: 'model-1',
			classificationRule: 'stored user instructions',
		});
		await plugin.onload();

		const file = createTestTFile('notes/one.md', 'one');
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(file);
		await plugin.processFrontmatter(1);
		await plugin.processFrontmatter(1);

		expect(mocks.classificationContexts).toHaveLength(1);
		expect(mocks.classify).toHaveBeenNthCalledWith(1, file, 1);
		expect(mocks.classify).toHaveBeenNthCalledWith(2, file, 1);
		expect(requireValue(plugin.settings.providers[0], 'loaded provider').auth).toEqual({
			type: 'oauth',
			oauth: expiredTokens,
		});
		expect(plugin.settings.classificationRule).toBe('stored user instructions');
		expect(plugin.addSettingTab).toHaveBeenCalledOnce();

		plugin.onunload();

		expect(mocks.deactivate).toHaveBeenCalledOnce();
		expect(mocks.noticeUnload).toHaveBeenCalledOnce();
	});

	it('pins the active file at command invocation even if the user switches tabs while it is pending', async () => {
		installClassificationService();
		const originalFile = createTestTFile('notes/original.md', 'original');
		const otherFile = createTestTFile('notes/other.md', 'other');
		let finish: (() => void) | undefined;
		mocks.classify.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(originalFile);

		const pending = plugin.processFrontmatter(1);
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(otherFile);
		requireValue(finish, 'classification completion callback')();
		await pending;

		expect(mocks.classify).toHaveBeenCalledOnce();
		expect(mocks.classify).toHaveBeenCalledWith(originalFile, 1);
	});

	it('pins the original file and field list for overlapping batches', async () => {
		installClassificationService();
		plugin.settings.frontmatter = [makeField(1), makeField(2)];
		const originalFile = createTestTFile('notes/original.md', 'original');
		const otherFile = createTestTFile('notes/other.md', 'other');
		let finishFirst: (() => void) | undefined;
		let call = 0;
		mocks.classify.mockImplementation((file: TFile, id: number) => {
			call += 1;
			if (call === 1) return new Promise<void>((resolve) => (finishFirst = resolve));
			return Promise.resolve();
		});
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(originalFile);

		const firstBatch = plugin.processAllFrontmatter();
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(otherFile);
		const overlappingBatch = plugin.processAllFrontmatter();
		await overlappingBatch;
		requireValue(finishFirst, 'first batch completion callback')();
		await firstBatch;

		expect(mocks.classify.mock.calls).toEqual([
			[originalFile, 1],
			[otherFile, 1],
			[otherFile, 2],
			[originalFile, 2],
		]);
	});

	it('keeps an existing batch bound to its original service lifetime', async () => {
		installClassificationService();
		plugin.settings.frontmatter = [makeField(1), makeField(2)];
		const replacement = vi.fn().mockResolvedValue(undefined);
		mocks.classify.mockImplementationOnce(async () => {
			Reflect.set(plugin, 'classificationService', { classify: replacement });
		});
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(createTestTFile('notes/one.md', 'one'));
		await plugin.processAllFrontmatter();
		expect(mocks.classify).toHaveBeenCalledTimes(2);
		expect(replacement).not.toHaveBeenCalled();
	});

	it('reports missing active files and unknown field IDs without invoking classification', async () => {
		installClassificationService();
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(null);

		await plugin.processFrontmatter(1);
		await plugin.processAllFrontmatter();

		expect(mocks.noticeShow).toHaveBeenCalledTimes(2);
		expect(mocks.noticeShow).toHaveBeenCalledWith('no_active_file');
		expect(mocks.classify).not.toHaveBeenCalled();

		const file = createTestTFile('notes/one.md', 'one');
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(file);
		await plugin.processFrontmatter(99);

		expect(mocks.noticeShow).toHaveBeenCalledWith('no_frontmatter_setting', { id: 99 });
		expect(mocks.classify).not.toHaveBeenCalled();
	});

	it('preserves canonical Codex provider auth and provider entries through startup', async () => {
		const tokens: OAuthTokens = {
			accessToken: 'stored-access-token',
			refreshToken: 'stored-refresh-token',
			expiresAt: 1,
			accountId: 'synthetic-account',
		};
		const provider: ProviderConfig = {
			name: 'Codex',
			baseUrl: 'https://provider.invalid',
			models: [{ id: 'model-1', name: 'Model 1' }],
			auth: { type: 'oauth', oauth: tokens },
		};
		const providers = [provider];
		vi.mocked(plugin.loadData).mockResolvedValue({
			frontmatter: [makeField(1)],
			providers,
		});

		await plugin.onload();

		expect(plugin.settings.providers).toBe(providers);
		const persistedProvider = requireValue(plugin.settings.providers[0], 'persisted provider');
		expect(persistedProvider).toBe(provider);
		expect(persistedProvider).toEqual({
			name: 'Codex',
			baseUrl: 'https://provider.invalid',
			models: [{ id: 'model-1', name: 'Model 1' }],
			auth: { type: 'oauth', oauth: tokens },
		});
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
	});

	it('uses the manifest name for native notices and routes notice actions to settings', async () => {
		const open = vi.fn();
		const openTabById = vi.fn();
		Reflect.set(app, 'setting', {
			open,
			openTabById,
		});

		await plugin.onload();

		expect(Notice.head).toBe(plugin.manifest.name);
		const [host, catalog, head] = requireValue(
			mocks.noticeArguments[0],
			'plugin notice constructor arguments'
		);
		expect(catalog).toBe(NOTICE_CATALOG);
		expect(head).toBe(plugin.manifest.name);
		requireValue(host.openSettings, 'notice settings action')();
		expect(open).toHaveBeenCalledOnce();
		expect(openTabById).toHaveBeenCalledWith(plugin.manifest.id);
	});
});
