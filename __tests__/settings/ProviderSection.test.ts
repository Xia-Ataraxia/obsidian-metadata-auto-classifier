import type { Mock } from 'vitest';
import { ProviderSection } from '../../src/ui/settings/ProviderSection';
import { ProviderModal } from '../../src/ui/settings/modals/ProviderModal';
import type { App } from 'obsidian';
import type AutoClassifierPlugin from '../../src/main';
import type { ProviderConfig, OAuthTokens } from '../../src/types';
import { formatTokenExpiry, isTokenExpired } from '../../src/ui/auth';
import { Setting } from '../../src/ui/settings/components/Setting';

const confirmationHarness = vi.hoisted(() => ({
	buttons: [] as Array<{ label: string; click: () => void }>,
}));

vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal<typeof import('obsidian')>();
	class InteractiveSetting extends original.Setting {
		constructor(containerEl: HTMLElement) {
			super(containerEl);
			Object.defineProperty(this, 'setName', { value: () => this });
			Object.defineProperty(this, 'setHeading', { value: () => this });
			Object.defineProperty(this, 'addButton', {
				value: (renderButton: (button: InstanceType<typeof original.ButtonComponent>) => void) => {
					const button = new original.ButtonComponent(containerEl);
					let label = '';
					Object.defineProperty(button, 'setButtonText', {
						value: (text: string) => {
							label = text;
							return button;
						},
					});
					Object.defineProperty(button, 'onClick', {
						value: (onClick: () => void) => {
							confirmationHarness.buttons.push({ label, click: onClick });
							return button;
						},
					});
					renderButton(button);
					return this;
				},
			});
		}
	}

	class InteractiveModal extends original.Modal {
		constructor(app: App) {
			super(app);
			Object.defineProperty(this, 'scope', { value: { register: vi.fn() } });
			Object.defineProperty(this, 'open', { value: () => this.onOpen() });
			Object.defineProperty(this, 'close', { value: () => this.onClose() });
		}
	}

	return { ...original, Modal: InteractiveModal, Setting: InteractiveSetting };
});

const mockFormatTokenExpiry = vi.mocked(formatTokenExpiry);
const mockIsTokenExpired = vi.mocked(isTokenExpired);
const mockProviderModal = vi.mocked(ProviderModal);
const mockSettingCreate = vi.mocked(Setting.create);

// Mock the provider/auth module
vi.mock('../../src/ui/auth', () => ({
	formatTokenExpiry: vi.fn((tokens) => {
		const remaining = tokens.expiresAt - Math.floor(Date.now() / 1000);
		if (remaining <= 0) return 'Expired';
		const hours = Math.floor(remaining / 3600);
		const minutes = Math.floor((remaining % 3600) / 60);
		return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
	}),
	isTokenExpired: vi.fn((tokens) => {
		const buffer = 300; // 5 minutes
		return Date.now() / 1000 >= tokens.expiresAt - buffer;
	}),
}));

// Mock the ProviderModal
vi.mock('../../src/ui/settings/modals/ProviderModal', () => ({
	ProviderModal: vi.fn().mockImplementation(function (this: { open: Mock; close: Mock }) {
		this.open = vi.fn();
		this.close = vi.fn();
	}),
}));

// Mock Setting component
vi.mock('../../src/ui/settings/components/Setting', () => ({
	Setting: {
		create: vi.fn(),
	},
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function isMockFunction(value: unknown): value is Mock {
	return typeof value === 'function' && 'mock' in value;
}

function isProviderModalMock(value: unknown): value is { open: Mock; close: Mock } {
	if (typeof value !== 'object' || value === null || !('open' in value) || !('close' in value))
		return false;
	return isMockFunction(value.open) && isMockFunction(value.close);
}

function createProviderContainer() {
	return { createDiv: vi.fn().mockReturnValue({}) };
}

function confirmationButton(label: string): { click: () => void } {
	const button = confirmationHarness.buttons.find((candidate) => candidate.label === label);
	if (!button) throw new Error(`Expected a ${label} confirmation button`);
	return button;
}

function providerDeleteButton(name: string, rowIndex = 0): { onClick: () => unknown } {
	const rows = mockSettingCreate.mock.calls
		.map(
			(call) =>
				call[1] as {
					name: string;
					buttons?: Array<{ text: string; onClick: () => unknown }>;
				}
		)
		.filter((setting) => setting.name === name);
	const button = rows[rowIndex]?.buttons?.find((candidate) => candidate.text === 'Delete');
	if (!button) throw new Error('Delete action was not rendered');
	return button;
}

type ProviderSaveCallback = (savedProvider: ProviderConfig) => void | Promise<void>;

async function invokeProviderSave(
	onSave: ProviderSaveCallback,
	savedProvider: ProviderConfig
): Promise<void> {
	await onSave(savedProvider);
}

describe('ProviderSection', () => {
	let providerSection: ProviderSection;
	let mockPlugin: Pick<AutoClassifierPlugin, 'settings' | 'isActive' | 'register' | 'saveSettings'>;
	let mockApp: Partial<App>;
	let onRefresh: Mock;
	let registeredCleanups: Array<() => void>;
	let pluginActive: boolean;

	beforeEach(() => {
		vi.clearAllMocks();
		confirmationHarness.buttons.length = 0;
		registeredCleanups = [];
		pluginActive = true;

		mockPlugin = {
			settings: {
				providers: [],
				selectedProvider: '',
				selectedModel: '',
				frontmatter: [],
				classificationRule: '',
				jev: { apiKey: '', model: '' },
			},
			isActive: vi.fn(() => pluginActive),
			register: vi.fn((cleanup: () => void) => {
				registeredCleanups.push(cleanup);
			}),
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};

		mockApp = {};
		onRefresh = vi.fn();

		providerSection = new ProviderSection(
			mockPlugin as AutoClassifierPlugin,
			mockApp as App,
			onRefresh
		);
	});

	function openModalSaveCallback(
		type: 'add' | 'edit',
		provider?: ProviderConfig
	): ProviderSaveCallback {
		(providerSection as any).openProviderModal(type, provider);
		const calls = mockProviderModal.mock.calls;
		const call = calls[calls.length - 1];
		if (!call) throw new Error('Provider modal was not opened');
		const onSave = call[1];
		if (!onSave) throw new Error('Provider modal save callback was not registered');
		return onSave;
	}

	function lastProviderModal(): { open: Mock; close: Mock } {
		const results = mockProviderModal.mock.results;
		const result = results[results.length - 1];
		if (!result || result.type !== 'return' || !isProviderModalMock(result.value))
			throw new Error('Provider modal was not created');
		return result.value;
	}

	function saveSettingsMock() {
		return vi.mocked(mockPlugin.saveSettings);
	}

	function providerAt(index: number): ProviderConfig {
		const provider = mockPlugin.settings.providers[index];
		if (!provider) throw new Error(`Expected provider at index ${index}`);
		return provider;
	}

	function runRegisteredCleanup(index: number): void {
		const cleanup = registeredCleanups[index];
		if (!cleanup) throw new Error(`Expected registered cleanup at index ${index}`);
		cleanup();
	}

	describe('getProviderDisplayInfo', () => {
		// Access private method via any
		const getDisplayInfo = (section: ProviderSection, provider: ProviderConfig) => {
			return (section as any).getProviderDisplayInfo(provider);
		};

		it('uses the provider authentication contract for non-OAuth providers', () => {
			const provider: ProviderConfig = {
				name: 'OpenAI',
				apiKey: 'test-key',
				baseUrl: 'https://api.openai.com',
				models: [],
			};

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('OpenAI');
			expect(result.desc).toBe('Connected');
			expect(getDisplayInfo(providerSection, { ...provider, apiKey: '' }).desc).toBe('No API key');
		});

		it('treats an explicitly null auth value as unauthenticated without throwing', () => {
			const provider: ProviderConfig = {
				name: 'OpenAI',
				apiKey: '',
				baseUrl: 'https://api.openai.com',
				models: [],
			};
			Object.defineProperty(provider, 'auth', { value: null, enumerable: true });

			expect(getDisplayInfo(providerSection, provider)).toEqual({
				name: 'OpenAI',
				desc: 'No API key',
			});
		});

		it('ignores stale OAuth credentials for an API-key provider', () => {
			const staleTokens: OAuthTokens = {
				accessToken: 'stale-access',
				refreshToken: 'refresh',
				expiresAt: Math.floor(Date.now() / 1000) - 100,
				accountId: 'account-id',
			};
			const provider: ProviderConfig = {
				name: 'OpenAI',
				apiKey: 'test-key',
				baseUrl: 'https://api.openai.com',
				models: [],
				authType: 'apiKey',
				oauth: staleTokens,
			};

			expect(getDisplayInfo(providerSection, provider)).toEqual({
				name: 'OpenAI',
				desc: 'Connected',
			});
			expect(mockIsTokenExpired).not.toHaveBeenCalled();
			expect(mockFormatTokenExpiry).not.toHaveBeenCalled();
		});

		it('should return OAuth status for provider with authType oauth', () => {
			const oauthTokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
				accountId: 'account-id',
			};

			const provider: ProviderConfig = {
				name: 'Codex',
				apiKey: '',
				baseUrl: 'https://codex.api',
				models: [],
				authType: 'oauth',
				oauth: oauthTokens,
			};

			mockIsTokenExpired.mockReturnValue(false);
			mockFormatTokenExpiry.mockReturnValue('2h 0m remaining');

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toBe('Signed in · 2h 0m remaining');
		});

		it('shows an OAuth provider without tokens as not signed in', () => {
			const provider: ProviderConfig = {
				name: 'Codex',
				apiKey: '',
				baseUrl: 'https://codex.api',
				models: [],
				authType: 'oauth',
				// No oauth field
			};

			mockIsTokenExpired.mockReturnValue(true);

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toBe('Not signed in');
		});

		it('shows expired OAuth tokens with a refresh token as signed in', () => {
			const expiredTokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: Math.floor(Date.now() / 1000) - 100, // Expired
				accountId: 'account-id',
			};

			const provider: ProviderConfig = {
				name: 'Codex',
				apiKey: '',
				baseUrl: 'https://codex.api',
				models: [],
				authType: 'oauth',
				oauth: expiredTokens,
			};

			mockIsTokenExpired.mockReturnValue(true);

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toBe('Signed in · refreshes on next use');
		});

		it('should detect OAuth provider by oauth field even without authType', () => {
			const oauthTokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: Math.floor(Date.now() / 1000) + 3600,
				accountId: 'account-id',
			};

			const provider: ProviderConfig = {
				name: 'Codex',
				apiKey: '',
				baseUrl: 'https://codex.api',
				models: [],
				// No authType but has oauth
				oauth: oauthTokens,
			};

			mockIsTokenExpired.mockReturnValue(false);
			mockFormatTokenExpiry.mockReturnValue('1h 0m remaining');

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toBe('Signed in · 1h 0m remaining');
		});
	});

	describe('render', () => {
		it('should render provider list with Setting.create', () => {
			const providers: ProviderConfig[] = [
				{
					name: 'OpenAI',
					apiKey: 'key1',
					baseUrl: 'https://api.openai.com',
					models: [],
				},
				{
					name: 'Anthropic',
					apiKey: 'key2',
					baseUrl: 'https://api.anthropic.com',
					models: [],
				},
			];

			const mockContainer = createProviderContainer();

			providerSection.render(mockContainer as unknown as HTMLElement, providers);

			// Should create a div with class 'provider-section'
			expect(mockContainer.createDiv).toHaveBeenCalledWith({ cls: 'provider-section' });

			// Should call Setting.create for each provider + 1 for "Add provider" button
			expect(mockSettingCreate).toHaveBeenCalledTimes(3);
		});

		it('should render OAuth status in provider description', () => {
			const oauthTokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: Math.floor(Date.now() / 1000) + 3600,
				accountId: 'account-id',
			};

			const providers: ProviderConfig[] = [
				{
					name: 'Codex',
					apiKey: '',
					baseUrl: 'https://codex.api',
					models: [],
					authType: 'oauth',
					oauth: oauthTokens,
				},
			];

			mockIsTokenExpired.mockReturnValue(false);
			mockFormatTokenExpiry.mockReturnValue('1h 0m remaining');

			const mockContainer = createProviderContainer();

			providerSection.render(mockContainer as unknown as HTMLElement, providers);

			// Should call Setting.create with OAuth status in desc
			expect(mockSettingCreate).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					name: 'Codex',
					desc: 'Signed in · 1h 0m remaining',
				})
			);
		});

		it('should add "Add provider" button at the end', () => {
			const providers: ProviderConfig[] = [];

			const mockContainer = createProviderContainer();

			providerSection.render(mockContainer as unknown as HTMLElement, providers);

			// Should call Setting.create once for "Add provider" button
			expect(mockSettingCreate).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					name: '',
					button: expect.objectContaining({
						text: '+ Add provider',
					}),
				})
			);
		});
	});

	describe('provider persistence', () => {
		function makeProvider(name: string): ProviderConfig {
			return {
				name,
				apiKey: `${name.toLowerCase()}-key`,
				baseUrl: 'https://api.example.com/v1/chat',
				models: [{ id: 'model-1', name: 'Model 1' }],
			};
		}

		it('rejects an add collision before mutating settings or persisting', async () => {
			const original = makeProvider('OpenAI');
			const providers = [original];
			mockPlugin.settings.providers = providers;
			const saveSettings = saveSettingsMock();
			const onSave = openModalSaveCallback('add');

			await expect(invokeProviderSave(onSave, makeProvider('OpenAI'))).rejects.toThrow(
				'already exists'
			);
			expect(mockPlugin.settings.providers).toBe(providers);
			expect(mockPlugin.settings.providers[0]).toBe(original);
			expect(saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});

		it('permits editing the original profile without renaming it', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings.providers = [original];
			mockPlugin.settings.selectedProvider = 'OpenAI';
			mockPlugin.settings.selectedModel = 'model-1';
			const savedProvider = { ...original, baseUrl: 'https://edited.example/v1/chat' };
			const onSave = openModalSaveCallback('edit', original);

			await invokeProviderSave(onSave, savedProvider);

			expect(mockPlugin.settings.providers).toEqual([savedProvider]);
			expect(mockPlugin.settings.providers[0]).toBe(savedProvider);
			expect(mockPlugin.settings.selectedProvider).toBe('OpenAI');
			expect(mockPlugin.settings.selectedModel).toBe('model-1');
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
			expect(onRefresh).toHaveBeenCalledOnce();
		});

		it('rejects an in-place credential refresh that made the modal target stale', async () => {
			const original: ProviderConfig = {
				...makeProvider('Codex'),
				authType: 'oauth',
				oauth: {
					accessToken: 'old-access',
					refreshToken: 'refresh-token',
					expiresAt: 100,
					accountId: 'account-1',
				},
			};
			mockPlugin.settings.providers = [original];
			const onSave = openModalSaveCallback('edit', original);
			const oauth = original.oauth;
			if (!oauth) throw new Error('Expected OAuth credentials on the stale provider');
			oauth.accessToken = 'refreshed-access';
			const saveSettings = saveSettingsMock();

			await expect(
				invokeProviderSave(onSave, { ...original, baseUrl: 'https://edited.example/v1/chat' })
			).rejects.toThrow('has changed');
			expect(mockPlugin.settings.providers[0]).toBe(original);
			expect(original.oauth?.accessToken).toBe('refreshed-access');
			expect(saveSettings).not.toHaveBeenCalled();
		});

		it('rejects saving a duplicate-name profile until that duplicate is explicitly renamed', async () => {
			const first = makeProvider('OpenAI');
			const second = makeProvider('OpenAI');
			const providers = [first, second];
			mockPlugin.settings.providers = providers;
			const onSave = openModalSaveCallback('edit', first);

			await expect(
				invokeProviderSave(onSave, { ...first, baseUrl: 'https://same-name.example/v1/chat' })
			).rejects.toThrow('already exists');
			expect(mockPlugin.settings.providers).toBe(providers);
			expect(mockPlugin.settings.providers).toEqual([first, second]);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();

			const renamed = { ...first, name: 'Anthropic' };
			await invokeProviderSave(onSave, renamed);
			expect(mockPlugin.settings.providers[0]).toBe(renamed);
			expect(mockPlugin.settings.providers[1]).toBe(second);
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
		});

		it('switches an added profile to the same edit target after successful persistence', async () => {
			const onSave = openModalSaveCallback('add');
			const added = makeProvider('OpenAI');
			await invokeProviderSave(onSave, added);

			const edited = { ...added, baseUrl: 'https://updated.example/v1/chat' };
			await invokeProviderSave(onSave, edited);

			expect(mockPlugin.settings.providers).toEqual([edited]);
			expect(mockPlugin.settings.providers[0]).toBe(edited);
			expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2);
		});

		it('treats mutations after an added profile save as stale before a draft update', async () => {
			const onSave = openModalSaveCallback('add');
			const added = makeProvider('OpenAI');
			await invokeProviderSave(onSave, added);
			added.baseUrl = 'https://external-update.example/v1/chat';

			await expect(
				invokeProviderSave(onSave, {
					...added,
					baseUrl: 'https://draft-update.example/v1/chat',
				})
			).rejects.toThrow('has changed');
			expect(mockPlugin.settings.providers[0]).toBe(added);
			expect(added.baseUrl).toBe('https://external-update.example/v1/chat');
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
		});

		it('registers modal closure and rejects saves after plugin unload before settings mutation', async () => {
			const onSave = openModalSaveCallback('add');
			const modal = lastProviderModal();
			expect(mockPlugin.register).toHaveBeenCalledOnce();
			expect(registeredCleanups).toHaveLength(1);

			pluginActive = false;
			runRegisteredCleanup(0);
			expect(modal.close).toHaveBeenCalledOnce();
			await expect(invokeProviderSave(onSave, makeProvider('OpenAI'))).rejects.toThrow(
				'no longer active'
			);
			expect(mockPlugin.isActive).toHaveBeenCalled();
			expect(mockPlugin.settings.providers).toEqual([]);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});

		it('suppresses refresh after an in-flight save resolves following plugin unload', async () => {
			const pending = deferred<void>();
			saveSettingsMock().mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('add');
			const modal = lastProviderModal();
			const attempt = invokeProviderSave(onSave, makeProvider('OpenAI'));
			expect(mockPlugin.settings.providers).toHaveLength(1);

			pluginActive = false;
			runRegisteredCleanup(0);
			expect(modal.close).toHaveBeenCalledOnce();
			pending.resolve(undefined);
			await attempt;

			expect(mockPlugin.isActive).toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
			expect(mockPlugin.settings.providers).toHaveLength(1);
		});

		it('rolls back only the failed write, preserves unrelated edits, and allows retry against the same target', async () => {
			const original = makeProvider('OpenAI');
			const unrelated = makeProvider('Anthropic');
			mockPlugin.settings.providers = [original, unrelated];
			mockPlugin.settings.selectedProvider = 'OpenAI';
			mockPlugin.settings.selectedModel = 'model-1';
			const pending = deferred<void>();
			const saveSettings = saveSettingsMock();
			saveSettings.mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const firstAttempt = invokeProviderSave(onSave, {
				...original,
				baseUrl: 'https://first-attempt.example/v1/chat',
			});
			const pendingProviders = mockPlugin.settings.providers;
			const pendingUnrelated = pendingProviders[1];
			if (!pendingUnrelated)
				throw new Error('Expected an unrelated provider during the pending save');
			pendingUnrelated.baseUrl = 'https://unrelated-edit.example/v1/chat';
			pending.reject(new Error('synthetic storage failure'));
			await expect(firstAttempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings.providers[0]).toBe(original);
			expect(mockPlugin.settings.providers[1]).toBe(unrelated);
			expect(unrelated.baseUrl).toBe('https://unrelated-edit.example/v1/chat');
			expect(mockPlugin.settings.selectedProvider).toBe('OpenAI');
			expect(mockPlugin.settings.selectedModel).toBe('model-1');

			const retry = { ...original, baseUrl: 'https://retry.example/v1/chat' };
			await invokeProviderSave(onSave, retry);
			expect(mockPlugin.settings.providers[0]).toBe(retry);
			expect(mockPlugin.settings.providers[1]).toBe(unrelated);
		});

		it('does not roll back or advance the retry target after the written provider is user-edited', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings.providers = [original];
			const pending = deferred<void>();
			saveSettingsMock().mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = invokeProviderSave(onSave, {
				...original,
				baseUrl: 'https://written.example/v1/chat',
			});
			const writtenProviders = mockPlugin.settings.providers;
			const written = writtenProviders[0];
			if (!written) throw new Error('Expected the edited provider in settings');
			written.baseUrl = 'https://user-edited.example/v1/chat';
			mockPlugin.settings.selectedProvider = 'Anthropic';
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings.providers).toBe(writtenProviders);
			expect(mockPlugin.settings.providers[0]).toBe(written);
			expect(written.baseUrl).toBe('https://user-edited.example/v1/chat');
			expect(mockPlugin.settings.selectedProvider).toBe('Anthropic');

			const retry = { ...written, baseUrl: 'https://retry.example/v1/chat' };
			await expect(invokeProviderSave(onSave, retry)).rejects.toThrow('has changed');
			expect(mockPlugin.settings.providers[0]).toBe(written);
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
		});

		it('rolls back from the current reordered list after deferred rejection without losing unrelated providers', async () => {
			const original = makeProvider('OpenAI');
			const unrelated = makeProvider('Anthropic');
			const newlyAdded = makeProvider('Gemini');
			mockPlugin.settings.providers = [original, unrelated];
			mockPlugin.settings.selectedProvider = 'OpenAI';
			const pending = deferred<void>();
			saveSettingsMock().mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = invokeProviderSave(onSave, {
				...original,
				baseUrl: 'https://written.example/v1/chat',
			});
			const written = providerAt(0);
			const replacedAndReordered = [newlyAdded, unrelated, written];
			mockPlugin.settings.providers = replacedAndReordered;
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings.providers).toBe(replacedAndReordered);
			expect(replacedAndReordered).toEqual([newlyAdded, unrelated, original]);
			expect(mockPlugin.settings.selectedProvider).toBe('OpenAI');
		});

		it('does not roll back a renamed selection onto a newly-added provider with the same name', async () => {
			const original = makeProvider('OpenAI');
			const unrelated = makeProvider('Anthropic');
			const replacementCodex = makeProvider('Codex');
			mockPlugin.settings.providers = [original, unrelated];
			mockPlugin.settings.selectedProvider = 'OpenAI';
			const pending = deferred<void>();
			saveSettingsMock().mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = invokeProviderSave(onSave, { ...original, name: 'Codex' });
			const written = providerAt(0);
			const replacedProviders = [replacementCodex, unrelated, written];
			mockPlugin.settings.providers = replacedProviders;
			mockPlugin.settings.selectedProvider = 'Codex';
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(replacedProviders).toEqual([replacementCodex, unrelated, original]);
			expect(mockPlugin.settings.selectedProvider).toBe('Codex');
		});

		it('does not roll back a replaced provider list or selection after a failed save', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings.providers = [original];
			const pending = deferred<void>();
			saveSettingsMock().mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = invokeProviderSave(onSave, {
				...original,
				baseUrl: 'https://written.example/v1/chat',
			});
			const replacement = makeProvider('Anthropic');
			const replacementList = [replacement];
			mockPlugin.settings.providers = replacementList;
			mockPlugin.settings.selectedProvider = 'Anthropic';
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings.providers).toBe(replacementList);
			expect(mockPlugin.settings.providers[0]).toBe(replacement);
			expect(mockPlugin.settings.selectedProvider).toBe('Anthropic');
		});

		it('renames the selected provider only after a deliberate preset change', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings.providers = [original];
			mockPlugin.settings.selectedProvider = 'OpenAI';
			mockPlugin.settings.selectedModel = 'model-1';
			const savedProvider = { ...original, name: 'Codex' };
			const onSave = openModalSaveCallback('edit', original);

			await invokeProviderSave(onSave, savedProvider);

			expect(mockPlugin.settings.providers[0]).toBe(savedProvider);
			expect(mockPlugin.settings.selectedProvider).toBe('Codex');
			expect(mockPlugin.settings.selectedModel).toBe('model-1');
		});

		it('rejects an edit collision without replacing either profile', async () => {
			const original = makeProvider('OpenAI');
			const collision = makeProvider('Anthropic');
			const providers = [original, collision];
			mockPlugin.settings.providers = providers;
			const onSave = openModalSaveCallback('edit', original);

			await expect(
				invokeProviderSave(onSave, { ...original, name: 'Anthropic' })
			).rejects.toThrow('already exists');
			expect(mockPlugin.settings.providers).toBe(providers);
			expect(mockPlugin.settings.providers).toEqual([original, collision]);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it('rejects a stale edit target instead of replacing another same-name profile', async () => {
			const original = makeProvider('OpenAI');
			const replacement = makeProvider('OpenAI');
			mockPlugin.settings.providers = [replacement];
			const onSave = openModalSaveCallback('edit', original);

			await expect(
				invokeProviderSave(onSave, {
					...original,
					baseUrl: 'https://edited.example/v1/chat',
				})
			).rejects.toThrow('has changed');
			expect(mockPlugin.settings.providers).toEqual([replacement]);
			expect(mockPlugin.settings.providers[0]).toBe(replacement);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it('deletes only the clicked duplicate-name provider and keeps selection while a duplicate remains', async () => {
			const first = makeProvider('OpenAI');
			const second = makeProvider('OpenAI');
			mockPlugin.settings.providers = [first, second];
			mockPlugin.settings.selectedProvider = 'OpenAI';
			mockPlugin.settings.selectedModel = 'model-1';
			providerSection.render(createProviderContainer() as unknown as HTMLElement, [first, second]);

			const deleteButton = providerDeleteButton('OpenAI');
			const deletion = deleteButton.onClick();
			expect(confirmationHarness.buttons.map((button) => button.label)).toEqual([
				'Cancel',
				'Delete',
			]);
			confirmationButton('Delete').click();
			await deletion;

			expect(mockPlugin.settings.providers).toEqual([second]);
			expect(mockPlugin.settings.providers[0]).toBe(second);
			expect(mockPlugin.settings.selectedProvider).toBe('OpenAI');
			expect(mockPlugin.settings.selectedModel).toBe('model-1');
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
			expect(onRefresh).toHaveBeenCalledOnce();
		});

		it('leaves the provider unchanged when deletion is canceled', async () => {
			const provider = makeProvider('OpenAI');
			mockPlugin.settings.providers = [provider];
			providerSection.render(createProviderContainer() as unknown as HTMLElement, [provider]);

			const deleteButton = providerDeleteButton('OpenAI');
			const deletion = deleteButton.onClick();
			confirmationButton('Cancel').click();
			await deletion;

			expect(mockPlugin.settings.providers).toEqual([provider]);
			expect(mockPlugin.settings.providers[0]).toBe(provider);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});

		it('does not delete a target edited while confirmation is pending', async () => {
			const provider = makeProvider('OpenAI');
			mockPlugin.settings.providers = [provider];
			providerSection.render(createProviderContainer() as unknown as HTMLElement, [provider]);

			const deleteButton = providerDeleteButton('OpenAI');
			const deletion = deleteButton.onClick();
			provider.apiKey = 'updated-during-confirmation';
			confirmationButton('Delete').click();
			await deletion;

			expect(mockPlugin.settings.providers).toEqual([provider]);
			expect(mockPlugin.settings.providers[0]).toBe(provider);
			expect(provider.apiKey).toBe('updated-during-confirmation');
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});

		it('does not delete a replacement profile while confirmation is pending', async () => {
			const provider = makeProvider('OpenAI');
			const replacement = makeProvider('OpenAI');
			mockPlugin.settings.providers = [provider];
			providerSection.render(createProviderContainer() as unknown as HTMLElement, [provider]);

			const deleteButton = providerDeleteButton('OpenAI');
			const deletion = deleteButton.onClick();
			mockPlugin.settings.providers = [replacement];
			confirmationButton('Delete').click();
			await deletion;

			expect(mockPlugin.settings.providers).toEqual([replacement]);
			expect(mockPlugin.settings.providers[0]).toBe(replacement);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});
	});
});
