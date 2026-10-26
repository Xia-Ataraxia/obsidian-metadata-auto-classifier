import { App, createMockTFile, type TFile } from 'obsidian';
import AutoClassifierPlugin from '../src/main';
import { DEFAULT_SETTINGS, NOTICE_CATALOG } from '../src/domain/constants';
import { Notice } from '../src/ui/settings/components/Notice';
import type {
	AutoClassifierSettings,
	FrontmatterField,
	OAuthTokens,
	ProviderConfig,
} from '../src/types';

const mocks = vi.hoisted(() => ({
	classify: vi.fn(),
	deactivate: vi.fn(),
	classificationContexts: [] as unknown[],
	noticeHosts: [] as unknown[],
	settingTabPlugins: [] as unknown[],
	noticeArguments: [] as unknown[][],
	noticeShow: vi.fn(),
	noticeUnload: vi.fn(),
	loggerInfo: vi.fn(),
	loggerError: vi.fn(),
}));

vi.mock('obsidian');

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
		constructor(...args: unknown[]) {
			mocks.noticeHosts.push(args[0]);
			mocks.noticeArguments.push(args);
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

describe('AutoClassifierPlugin', () => {
	let app: App;
	let plugin: AutoClassifierPlugin;

	function installClassificationService(): void {
		(plugin as any).classificationService = {
			classify: (file: TFile, id: number) => mocks.classify(file, id),
			deactivate: () => mocks.deactivate(),
		};
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
		plugin = new AutoClassifierPlugin(app);
		plugin.settings = {
			...DEFAULT_SETTINGS,
			jev: { ...DEFAULT_SETTINGS.jev },
			providers: [],
			frontmatter: [makeField(1)],
			classificationRule: 'synthetic instructions',
		} as AutoClassifierSettings;
		plugin.notices = {
			show: mocks.noticeShow,
			unload: mocks.noticeUnload,
		} as any;
		plugin.logger = {
			info: mocks.loggerInfo,
			error: mocks.loggerError,
		} as any;
	});

	describe('settings persistence', () => {
		it('merges stored settings with Jev defaults and repairs missing field counts', async () => {
			(plugin.loadData as ReturnType<typeof vi.fn>).mockResolvedValue({
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
			expect(plugin.settings.frontmatter[0].count).toEqual({ min: 1, max: 5 });
			expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		});

		it('saves the current settings object', async () => {
			await plugin.saveSettings();

			expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		});
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
			const command = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
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
		(plugin.loadData as ReturnType<typeof vi.fn>).mockResolvedValue({
			frontmatter: [makeField(1)],
			providers: [provider],
			selectedProvider: 'Codex',
			selectedModel: 'model-1',
			classificationRule: 'stored user instructions',
		});
		await plugin.onload();

		const file = createMockTFile('notes/one.md', 'one');
		app.workspace.getActiveFile.mockReturnValue(file);
		await plugin.processFrontmatter(1);
		await plugin.processFrontmatter(1);

		expect(mocks.classificationContexts).toHaveLength(1);
		expect(mocks.classify).toHaveBeenNthCalledWith(1, file, 1);
		expect(mocks.classify).toHaveBeenNthCalledWith(2, file, 1);
		expect(plugin.settings.providers[0].auth).toEqual({ type: 'oauth', oauth: expiredTokens });
		expect(plugin.settings.classificationRule).toBe('stored user instructions');
		expect(plugin.addSettingTab).toHaveBeenCalledOnce();

		plugin.onunload();

		expect(mocks.deactivate).toHaveBeenCalledOnce();
		expect(mocks.noticeUnload).toHaveBeenCalledOnce();
	});

	it('pins the active file at command invocation even if the user switches tabs while it is pending', async () => {
		installClassificationService();
		const originalFile = createMockTFile('notes/original.md', 'original');
		const otherFile = createMockTFile('notes/other.md', 'other');
		let finish!: () => void;
		mocks.classify.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
		app.workspace.getActiveFile.mockReturnValue(originalFile);

		const pending = plugin.processFrontmatter(1);
		app.workspace.getActiveFile.mockReturnValue(otherFile);
		finish();
		await pending;

		expect(mocks.classify).toHaveBeenCalledOnce();
		expect(mocks.classify).toHaveBeenCalledWith(originalFile, 1);
	});

	it('pins the original file and field list for overlapping batches', async () => {
		installClassificationService();
		plugin.settings.frontmatter = [makeField(1), makeField(2)];
		const originalFile = createMockTFile('notes/original.md', 'original');
		const otherFile = createMockTFile('notes/other.md', 'other');
		let finishFirst!: () => void;
		let call = 0;
		mocks.classify.mockImplementation((file: TFile, id: number) => {
			call += 1;
			if (call === 1) return new Promise<void>((resolve) => (finishFirst = resolve));
			return Promise.resolve();
		});
		app.workspace.getActiveFile.mockReturnValue(originalFile);

		const firstBatch = plugin.processAllFrontmatter();
		app.workspace.getActiveFile.mockReturnValue(otherFile);
		const overlappingBatch = plugin.processAllFrontmatter();
		await overlappingBatch;
		finishFirst();
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
			(plugin as any).classificationService = { classify: replacement };
		});
		app.workspace.getActiveFile.mockReturnValue(createMockTFile('notes/one.md', 'one'));
		await plugin.processAllFrontmatter();
		expect(mocks.classify).toHaveBeenCalledTimes(2);
		expect(replacement).not.toHaveBeenCalled();
	});

	it('reports missing active files and unknown field IDs without invoking classification', async () => {
		installClassificationService();
		app.workspace.getActiveFile.mockReturnValue(null);

		await plugin.processFrontmatter(1);
		await plugin.processAllFrontmatter();

		expect(mocks.noticeShow).toHaveBeenCalledTimes(2);
		expect(mocks.noticeShow).toHaveBeenCalledWith('no_active_file');
		expect(mocks.classify).not.toHaveBeenCalled();

		const file = createMockTFile('notes/one.md', 'one');
		app.workspace.getActiveFile.mockReturnValue(file);
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
		(plugin.loadData as ReturnType<typeof vi.fn>).mockResolvedValue({
			frontmatter: [makeField(1)],
			providers,
		});

		await plugin.onload();

		expect(plugin.settings.providers).toBe(providers);
		expect(plugin.settings.providers[0]).toBe(provider);
		expect(plugin.settings.providers[0]).toEqual({
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
		(app as App & { setting?: { open: () => void; openTabById: (id: string) => void } }).setting = {
			open,
			openTabById,
		};

		await plugin.onload();

		expect(Notice.head).toBe(plugin.manifest.name);
		const [host, catalog, head] = mocks.noticeArguments[0] as [
			{ openSettings: () => void },
			typeof NOTICE_CATALOG,
			string,
		];
		expect(catalog).toBe(NOTICE_CATALOG);
		expect(head).toBe(plugin.manifest.name);
		host.openSettings();
		expect(open).toHaveBeenCalledOnce();
		expect(openTabById).toHaveBeenCalledWith(plugin.manifest.id);
	});
});
