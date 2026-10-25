import type { Mock } from 'vitest';
import { ProviderSection } from '../../src/ui/settings/ProviderSection';
import { ProviderModal } from '../../src/ui/settings/modals/ProviderModal';
import type { App } from 'obsidian';
import type AutoClassifierPlugin from '../../src/main';
import type { ProviderConfig, OAuthTokens } from '../../src/types';
import { formatTokenExpiry, isTokenExpired } from '../../src/ui/auth';
import { Setting } from '../../src/ui/settings/components/Setting';

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
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('ProviderSection', () => {
	let providerSection: ProviderSection;
	let mockPlugin: Partial<AutoClassifierPlugin>;
	let mockApp: Partial<App>;
	let onRefresh: Mock;
	let registeredCleanups: Array<() => void>;
	let pluginActive: boolean;

	beforeEach(() => {
		vi.clearAllMocks();
		registeredCleanups = [];
		pluginActive = true;

		mockPlugin = {
			settings: {
				providers: [],
				selectedProvider: '',
				selectedModel: '',
				frontmatter: [],
				classificationRule: '',
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

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function openModalSaveCallback(
		type: 'add' | 'edit',
		provider?: ProviderConfig
	): (savedProvider: ProviderConfig) => Promise<void> {
		(providerSection as any).openProviderModal(type, provider);
		const calls = (ProviderModal as unknown as Mock).mock.calls;
		const call = calls.at(-1);
		if (!call) throw new Error('Provider modal was not opened');
		return call[1] as (savedProvider: ProviderConfig) => Promise<void>;
	}

	function lastProviderModal(): { open: Mock; close: Mock } {
		const modal = (ProviderModal as unknown as Mock).mock.results.at(-1)?.value as
			| { open: Mock; close: Mock }
			| undefined;
		if (!modal) throw new Error('Provider modal was not created');
		return modal;
	}

	describe('getProviderDisplayInfo', () => {
		// Access private method via any
		const getDisplayInfo = (section: ProviderSection, provider: ProviderConfig) => {
			return (section as any).getProviderDisplayInfo(provider);
		};

		it('should return empty desc for non-OAuth provider', () => {
			const provider: ProviderConfig = {
				name: 'OpenAI',
				apiKey: 'test-key',
				baseUrl: 'https://api.openai.com',
				models: [],
			};

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('OpenAI');
			expect(result.desc).toBe('');
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

			isTokenExpired.mockReturnValue(false);
			formatTokenExpiry.mockReturnValue('2h 0m remaining');

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toContain('OAuth Connected');
			expect(result.desc).toContain('2h 0m remaining');
		});

		it('should return "OAuth Not Connected" for OAuth provider without tokens', () => {
			const provider: ProviderConfig = {
				name: 'Codex',
				apiKey: '',
				baseUrl: 'https://codex.api',
				models: [],
				authType: 'oauth',
				// No oauth field
			};

			isTokenExpired.mockReturnValue(true);

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toBe('OAuth Not Connected');
		});

		it('should return "OAuth Not Connected" for expired tokens', () => {
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

			isTokenExpired.mockReturnValue(true);

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toBe('OAuth Not Connected');
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

			isTokenExpired.mockReturnValue(false);
			formatTokenExpiry.mockReturnValue('1h 0m remaining');

			const result = getDisplayInfo(providerSection, provider);

			expect(result.name).toBe('Codex');
			expect(result.desc).toContain('OAuth Connected');
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

			const mockContainer = {
				createEl: vi.fn().mockReturnValue({
					createEl: vi.fn(),
				}),
			} as unknown as HTMLElement;

			providerSection.render(mockContainer, providers);

			// Should create a div with class 'provider-section'
			expect(mockContainer.createEl).toHaveBeenCalledWith('div', { cls: 'provider-section' });

			// Should call Setting.create for each provider + 1 for "Add provider" button
			expect(Setting.create).toHaveBeenCalledTimes(3);
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

			isTokenExpired.mockReturnValue(false);
			formatTokenExpiry.mockReturnValue('1h 0m remaining');

			const mockContainer = {
				createEl: vi.fn().mockReturnValue({
					createEl: vi.fn(),
				}),
			} as unknown as HTMLElement;

			providerSection.render(mockContainer, providers);

			// Should call Setting.create with OAuth status in desc
			expect(Setting.create).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					name: 'Codex',
					desc: expect.stringContaining('OAuth Connected'),
				})
			);
		});

		it('should add "Add provider" button at the end', () => {
			const providers: ProviderConfig[] = [];

			const mockContainer = {
				createEl: vi.fn().mockReturnValue({
					createEl: vi.fn(),
				}),
			} as unknown as HTMLElement;

			providerSection.render(mockContainer, providers);

			// Should call Setting.create once for "Add provider" button
			expect(Setting.create).toHaveBeenCalledWith(
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
			mockPlugin.settings!.providers = providers;
			const saveSettings = mockPlugin.saveSettings as Mock;
			const onSave = openModalSaveCallback('add');

			await expect(onSave(makeProvider('OpenAI'))).rejects.toThrow('already exists');
			expect(mockPlugin.settings!.providers).toBe(providers);
			expect(mockPlugin.settings!.providers[0]).toBe(original);
			expect(saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});

		it('permits editing the original profile without renaming it', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings!.providers = [original];
			mockPlugin.settings!.selectedProvider = 'OpenAI';
			mockPlugin.settings!.selectedModel = 'model-1';
			const savedProvider = { ...original, baseUrl: 'https://edited.example/v1/chat' };
			const onSave = openModalSaveCallback('edit', original);

			await onSave(savedProvider);

			expect(mockPlugin.settings!.providers).toEqual([savedProvider]);
			expect(mockPlugin.settings!.providers[0]).toBe(savedProvider);
			expect(mockPlugin.settings!.selectedProvider).toBe('OpenAI');
			expect(mockPlugin.settings!.selectedModel).toBe('model-1');
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
			mockPlugin.settings!.providers = [original];
			const onSave = openModalSaveCallback('edit', original);
			original.oauth!.accessToken = 'refreshed-access';
			const saveSettings = mockPlugin.saveSettings as Mock;

			await expect(
				onSave({ ...original, baseUrl: 'https://edited.example/v1/chat' })
			).rejects.toThrow('has changed');
			expect(mockPlugin.settings!.providers[0]).toBe(original);
			expect(original.oauth?.accessToken).toBe('refreshed-access');
			expect(saveSettings).not.toHaveBeenCalled();
		});

		it('rejects saving a duplicate-name profile until that duplicate is explicitly renamed', async () => {
			const first = makeProvider('OpenAI');
			const second = makeProvider('OpenAI');
			const providers = [first, second];
			mockPlugin.settings!.providers = providers;
			const onSave = openModalSaveCallback('edit', first);

			await expect(
				onSave({ ...first, baseUrl: 'https://same-name.example/v1/chat' })
			).rejects.toThrow('already exists');
			expect(mockPlugin.settings!.providers).toBe(providers);
			expect(mockPlugin.settings!.providers).toEqual([first, second]);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();

			await onSave({ ...first, name: 'Anthropic' });
			expect(mockPlugin.settings!.providers[0]?.name).toBe('Anthropic');
			expect(mockPlugin.settings!.providers[1]).toBe(second);
		});

		it('switches an added profile to the same edit target after successful persistence', async () => {
			const onSave = openModalSaveCallback('add');
			const added = makeProvider('OpenAI');
			await onSave(added);

			const edited = { ...added, baseUrl: 'https://updated.example/v1/chat' };
			await onSave(edited);

			expect(mockPlugin.settings!.providers).toEqual([edited]);
			expect(mockPlugin.settings!.providers[0]).toBe(edited);
			expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2);
		});

		it('treats mutations after an added profile save as stale before a draft update', async () => {
			const onSave = openModalSaveCallback('add');
			const added = makeProvider('OpenAI');
			await onSave(added);
			added.baseUrl = 'https://external-update.example/v1/chat';

			await expect(
				onSave({ ...added, baseUrl: 'https://draft-update.example/v1/chat' })
			).rejects.toThrow('has changed');
			expect(mockPlugin.settings!.providers[0]).toBe(added);
			expect(added.baseUrl).toBe('https://external-update.example/v1/chat');
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
		});

		it('registers modal closure and rejects saves after plugin unload before settings mutation', async () => {
			const onSave = openModalSaveCallback('add');
			const modal = lastProviderModal();
			expect(mockPlugin.register).toHaveBeenCalledOnce();
			expect(registeredCleanups).toHaveLength(1);

			pluginActive = false;
			registeredCleanups[0]!();
			expect(modal.close).toHaveBeenCalledOnce();
			await expect(onSave(makeProvider('OpenAI'))).rejects.toThrow('no longer active');
			expect(mockPlugin.isActive).toHaveBeenCalled();
			expect(mockPlugin.settings!.providers).toEqual([]);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
		});

		it('suppresses refresh after an in-flight save resolves following plugin unload', async () => {
			const pending = deferred<void>();
			(mockPlugin.saveSettings as Mock).mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('add');
			const modal = lastProviderModal();
			const attempt = onSave(makeProvider('OpenAI'));
			expect(mockPlugin.settings!.providers).toHaveLength(1);

			pluginActive = false;
			registeredCleanups[0]!();
			expect(modal.close).toHaveBeenCalledOnce();
			pending.resolve(undefined);
			await attempt;

			expect(mockPlugin.isActive).toHaveBeenCalled();
			expect(onRefresh).not.toHaveBeenCalled();
			expect(mockPlugin.settings!.providers).toHaveLength(1);
		});

		it('rolls back only the failed write, preserves unrelated edits, and allows retry against the same target', async () => {
			const original = makeProvider('OpenAI');
			const unrelated = makeProvider('Anthropic');
			mockPlugin.settings!.providers = [original, unrelated];
			mockPlugin.settings!.selectedProvider = 'OpenAI';
			mockPlugin.settings!.selectedModel = 'model-1';
			const pending = deferred<void>();
			const saveSettings = mockPlugin.saveSettings as Mock;
			saveSettings.mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const firstAttempt = onSave({
				...original,
				baseUrl: 'https://first-attempt.example/v1/chat',
			});
			const pendingProviders = mockPlugin.settings!.providers;
			pendingProviders[1]!.baseUrl = 'https://unrelated-edit.example/v1/chat';
			pending.reject(new Error('synthetic storage failure'));
			await expect(firstAttempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings!.providers[0]).toBe(original);
			expect(mockPlugin.settings!.providers[1]).toBe(unrelated);
			expect(unrelated.baseUrl).toBe('https://unrelated-edit.example/v1/chat');
			expect(mockPlugin.settings!.selectedProvider).toBe('OpenAI');
			expect(mockPlugin.settings!.selectedModel).toBe('model-1');

			const retry = { ...original, baseUrl: 'https://retry.example/v1/chat' };
			await onSave(retry);
			expect(mockPlugin.settings!.providers[0]).toBe(retry);
			expect(mockPlugin.settings!.providers[1]).toBe(unrelated);
		});

		it('does not roll back or advance the retry target after the written provider is user-edited', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings!.providers = [original];
			const pending = deferred<void>();
			(mockPlugin.saveSettings as Mock).mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = onSave({ ...original, baseUrl: 'https://written.example/v1/chat' });
			const writtenProviders = mockPlugin.settings!.providers;
			const written = writtenProviders[0]!;
			written.baseUrl = 'https://user-edited.example/v1/chat';
			mockPlugin.settings!.selectedProvider = 'Anthropic';
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings!.providers).toBe(writtenProviders);
			expect(mockPlugin.settings!.providers[0]).toBe(written);
			expect(written.baseUrl).toBe('https://user-edited.example/v1/chat');
			expect(mockPlugin.settings!.selectedProvider).toBe('Anthropic');

			const retry = { ...written, baseUrl: 'https://retry.example/v1/chat' };
			await expect(onSave(retry)).rejects.toThrow('has changed');
			expect(mockPlugin.settings!.providers[0]).toBe(written);
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
		});

		it('rolls back from the current reordered list after deferred rejection without losing unrelated providers', async () => {
			const original = makeProvider('OpenAI');
			const unrelated = makeProvider('Anthropic');
			const newlyAdded = makeProvider('Gemini');
			mockPlugin.settings!.providers = [original, unrelated];
			mockPlugin.settings!.selectedProvider = 'OpenAI';
			const pending = deferred<void>();
			(mockPlugin.saveSettings as Mock).mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = onSave({ ...original, baseUrl: 'https://written.example/v1/chat' });
			const written = mockPlugin.settings!.providers[0]!;
			const replacedAndReordered = [newlyAdded, unrelated, written];
			mockPlugin.settings!.providers = replacedAndReordered;
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings!.providers).toBe(replacedAndReordered);
			expect(replacedAndReordered).toEqual([newlyAdded, unrelated, original]);
			expect(mockPlugin.settings!.selectedProvider).toBe('OpenAI');
		});

		it('does not roll back a renamed selection onto a newly-added provider with the same name', async () => {
			const original = makeProvider('OpenAI');
			const unrelated = makeProvider('Anthropic');
			const replacementCodex = makeProvider('Codex');
			mockPlugin.settings!.providers = [original, unrelated];
			mockPlugin.settings!.selectedProvider = 'OpenAI';
			const pending = deferred<void>();
			(mockPlugin.saveSettings as Mock).mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = onSave({ ...original, name: 'Codex' });
			const written = mockPlugin.settings!.providers[0]!;
			const replacedProviders = [replacementCodex, unrelated, written];
			mockPlugin.settings!.providers = replacedProviders;
			mockPlugin.settings!.selectedProvider = 'Codex';
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(replacedProviders).toEqual([replacementCodex, unrelated, original]);
			expect(mockPlugin.settings!.selectedProvider).toBe('Codex');
		});

		it('does not roll back a replaced provider list or selection after a failed save', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings!.providers = [original];
			const pending = deferred<void>();
			(mockPlugin.saveSettings as Mock).mockReturnValueOnce(pending.promise);
			const onSave = openModalSaveCallback('edit', original);
			const attempt = onSave({ ...original, baseUrl: 'https://written.example/v1/chat' });
			const replacement = makeProvider('Anthropic');
			const replacementList = [replacement];
			mockPlugin.settings!.providers = replacementList;
			mockPlugin.settings!.selectedProvider = 'Anthropic';
			pending.reject(new Error('synthetic storage failure'));
			await expect(attempt).rejects.toThrow('synthetic storage failure');

			expect(mockPlugin.settings!.providers).toBe(replacementList);
			expect(mockPlugin.settings!.providers[0]).toBe(replacement);
			expect(mockPlugin.settings!.selectedProvider).toBe('Anthropic');
		});

		it('renames the selected provider only after a deliberate preset change', async () => {
			const original = makeProvider('OpenAI');
			mockPlugin.settings!.providers = [original];
			mockPlugin.settings!.selectedProvider = 'OpenAI';
			mockPlugin.settings!.selectedModel = 'model-1';
			const savedProvider = { ...original, name: 'Codex' };
			const onSave = openModalSaveCallback('edit', original);

			await onSave(savedProvider);

			expect(mockPlugin.settings!.providers[0]).toBe(savedProvider);
			expect(mockPlugin.settings!.selectedProvider).toBe('Codex');
			expect(mockPlugin.settings!.selectedModel).toBe('model-1');
		});

		it('rejects an edit collision without replacing either profile', async () => {
			const original = makeProvider('OpenAI');
			const collision = makeProvider('Anthropic');
			const providers = [original, collision];
			mockPlugin.settings!.providers = providers;
			const onSave = openModalSaveCallback('edit', original);

			await expect(onSave({ ...original, name: 'Anthropic' })).rejects.toThrow('already exists');
			expect(mockPlugin.settings!.providers).toBe(providers);
			expect(mockPlugin.settings!.providers).toEqual([original, collision]);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it('rejects a stale edit target instead of replacing another same-name profile', async () => {
			const original = makeProvider('OpenAI');
			const replacement = makeProvider('OpenAI');
			mockPlugin.settings!.providers = [replacement];
			const onSave = openModalSaveCallback('edit', original);

			await expect(
				onSave({ ...original, baseUrl: 'https://edited.example/v1/chat' })
			).rejects.toThrow('has changed');
			expect(mockPlugin.settings!.providers).toEqual([replacement]);
			expect(mockPlugin.settings!.providers[0]).toBe(replacement);
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it('deletes only the clicked duplicate-name provider and keeps selection while a duplicate remains', async () => {
			const first = makeProvider('OpenAI');
			const second = makeProvider('OpenAI');
			mockPlugin.settings!.providers = [first, second];
			mockPlugin.settings!.selectedProvider = 'OpenAI';
			mockPlugin.settings!.selectedModel = 'model-1';
			vi.stubGlobal(
				'confirm',
				vi.fn(() => true)
			);
			const containerEl = {
				createEl: vi.fn().mockReturnValue({ createEl: vi.fn() }),
			} as unknown as HTMLElement;
			providerSection.render(containerEl, [first, second]);

			const rows = (Setting.create as unknown as Mock).mock.calls
				.map(
					(call) =>
						call[1] as {
							name: string;
							buttons?: Array<{ text: string; onClick: () => unknown }>;
						}
				)
				.filter((setting) => setting.name === 'OpenAI');
			const deleteButton = rows[0]?.buttons?.find((button) => button.text === 'Delete');
			if (!deleteButton) throw new Error('Delete action was not rendered');
			await deleteButton.onClick();

			expect(mockPlugin.settings!.providers).toEqual([second]);
			expect(mockPlugin.settings!.providers[0]).toBe(second);
			expect(mockPlugin.settings!.selectedProvider).toBe('OpenAI');
			expect(mockPlugin.settings!.selectedModel).toBe('model-1');
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
			expect(onRefresh).toHaveBeenCalledOnce();
		});
	});
});
