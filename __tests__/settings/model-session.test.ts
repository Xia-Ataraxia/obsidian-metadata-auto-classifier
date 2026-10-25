import { App } from 'obsidian';
import type { Model, OAuthTokens, ProviderConfig } from '../../src/types';
import { COMMON_CONSTANTS } from '../../src/domain/constants';
import { ClassificationStateError, copyProvider } from '../../src/domain/classification-state';
import { ModelSection } from '../../src/ui/settings/ModelSection';
import { Setting } from '../../src/ui/settings/components/Setting';
import { testModel } from '../../src/ui/provider-api';
import { createProviderSession } from '../../src/ui/provider-session';
import type { HttpRequestOptions } from '../../src/ui/request';
import type AutoClassifierPlugin from '../../src/main';
import type { OnTokenRefreshCallback } from '../../src/types';

const { callAPI, modelModalProps, modelModalCloses } = vi.hoisted(() => ({
	callAPI: vi.fn(),
	modelModalProps: [] as unknown[],
	modelModalCloses: [] as Array<ReturnType<typeof vi.fn>>,
}));
vi.mock('../../src/ui/UnifiedProvider', () => ({
	UnifiedProvider: class {
		callAPI = callAPI;
	},
}));
vi.mock('../../src/ui/settings/components/Setting', () => ({ Setting: { create: vi.fn() } }));
vi.mock('../../src/ui/settings/modals/ModelModal', () => ({
	ModelModal: class {
		close = vi.fn();
		constructor(_app: unknown, props: unknown) {
			modelModalProps.push(props);
			modelModalCloses.push(this.close);
		}
		open() {}
	},
}));

const initialTokens: OAuthTokens = {
	accessToken: 'initial-access-secret',
	refreshToken: 'initial-refresh-secret',
	expiresAt: 1_900_000_000,
	accountId: 'synthetic-account',
};
const refreshedTokens: OAuthTokens = {
	accessToken: 'refreshed-access-secret',
	refreshToken: 'refreshed-refresh-secret',
	expiresAt: 2_000_000_000,
	accountId: 'synthetic-account',
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function oauthProvider(): ProviderConfig {
	return {
		name: 'Codex',
		baseUrl: 'https://example.invalid/v1',
		models: [{ id: 'model-a', name: 'Model A' }],
		auth: { type: 'oauth', oauth: { ...initialTokens } },
	};
}

function renderModelSection(plugin: AutoClassifierPlugin, onRefresh = vi.fn()): void {
	const container = { createEl: vi.fn() };
	container.createEl.mockReturnValue(container);
	new ModelSection(plugin, new App(), onRefresh).render(
		container as unknown as HTMLElement,
		plugin.settings.providers,
		'not-the-tested-model'
	);
}

function modelRowAction(
	plugin: AutoClassifierPlugin,
	text: 'Select' | 'Test' | 'Edit' | 'Delete',
	row = 0,
	onRefresh = vi.fn()
): () => void | Promise<void> {
	renderModelSection(plugin, onRefresh);
	const button = vi
		.mocked(Setting.create)
		.mock.calls.flatMap(([, props]) => props.buttons ?? [])
		.filter((item) => item.text === text)[row];
	if (!button) throw new Error(`${text} button was not rendered`);
	return button.onClick;
}

function modelAction(plugin: AutoClassifierPlugin, row = 0): () => void | Promise<void> {
	return modelRowAction(plugin, 'Test', row);
}

function modelSaveAction(
	plugin: AutoClassifierPlugin,
	row = 0
): (result: {
	provider: string;
	model: Model;
	isEdit: boolean;
	oldModel?: { model: string; provider: string };
}) => Promise<void> {
	modelRowAction(plugin, 'Edit', row)();
	const props = modelModalProps.at(-1) as {
		onSave: (result: {
			provider: string;
			model: Model;
			isEdit: boolean;
			oldModel?: { model: string; provider: string };
		}) => Promise<void>;
	};
	if (!props) throw new Error('Model modal was not opened');
	return props.onSave;
}

function modelPlugin(provider: ProviderConfig | ProviderConfig[]) {
	const state = {
		active: true,
		cleanups: [] as Array<() => void>,
		settings: {
			providers: Array.isArray(provider) ? provider : [provider],
			selectedProvider: 'A different provider',
			selectedModel: 'a different model',
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
		notices: { show: vi.fn() },
		register: vi.fn((cleanup: () => void) => state.cleanups.push(cleanup)),
		onRefresh: vi.fn(),
	};
	const plugin = {
		settings: state.settings,
		isActive: () => state.active,
		register: state.register,
		saveSettings: state.saveSettings,
		notices: state.notices,
	} as unknown as AutoClassifierPlugin;
	return {
		state,
		plugin,
		saveSettings: state.saveSettings,
		show: state.notices.show,
		onRefresh: state.onRefresh,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	modelModalProps.length = 0;
	modelModalCloses.length = 0;
	callAPI.mockReset().mockResolvedValue({ tags: [] });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('provider session token persistence', () => {
	it('waits for saving refreshed tokens and updates only the selected auth shape', async () => {
		const provider = oauthProvider();
		const legacyTokens = { ...initialTokens, accessToken: 'legacy-access-secret' };
		provider.oauth = legacyTokens;
		const save = deferred<void>();
		const saveSettings = vi.fn(() => save.promise);
		const session = createProviderSession({
			getProvider: () => provider,
			saveSettings,
			assertCurrent: vi.fn(),
		});

		const refresh = session.refreshTokens(refreshedTokens);
		let completed = false;
		void refresh.then(() => (completed = true));
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(provider.auth).toEqual({ type: 'oauth', oauth: refreshedTokens });
		expect(provider.oauth).toEqual(legacyTokens);
		expect(completed).toBe(false);

		save.resolve();
		await refresh;
		session.assertCurrent();
		expect(completed).toBe(true);
		expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toEqual(refreshedTokens);
	});

	it('blocks competing sessions until refreshed credentials are persisted', async () => {
		const provider = oauthProvider();
		const save = deferred<void>();
		const context = {
			getProvider: () => provider,
			saveSettings: () => save.promise,
			assertCurrent: vi.fn(),
		};
		const oldSession = createProviderSession(context);
		const refreshingSession = createProviderSession(context);
		const refresh = refreshingSession.refreshTokens(refreshedTokens);

		expect(() => oldSession.assertCurrent()).toThrow(ClassificationStateError);
		expect(() => createProviderSession(context)).toThrow(ClassificationStateError);
		expect(() =>
			createProviderSession({ ...context, getProvider: () => copyProvider(provider) })
		).toThrow(ClassificationStateError);

		save.resolve();
		await refresh;
		const persistedSession = createProviderSession(context);
		expect(
			persistedSession.provider.auth?.type === 'oauth' && persistedSession.provider.auth.oauth
		).toEqual(refreshedTokens);
		expect(() => persistedSession.assertCurrent()).not.toThrow();
		expect(() => oldSession.assertCurrent()).toThrow(ClassificationStateError);
	});

	it('does not let pending Codex tokens block or refresh a valid API-key session', async () => {
		const codex = oauthProvider();
		const codexSave = deferred<void>();
		const codexSession = createProviderSession({
			getProvider: () => codex,
			saveSettings: () => codexSave.promise,
			assertCurrent: vi.fn(),
		});
		const refresh = codexSession.refreshTokens(refreshedTokens);
		expect(codex.auth?.type === 'oauth' && codex.auth.oauth).toEqual(refreshedTokens);

		const apiKeyProvider: ProviderConfig = {
			name: 'OpenAI',
			baseUrl: 'https://api.example.invalid/v1',
			models: [{ id: 'api-model', name: 'API model' }],
			auth: { type: 'apiKey', apiKey: 'api-key-secret' },
			oauth: { ...refreshedTokens },
		};
		const apiKeySave = vi.fn().mockResolvedValue(undefined);
		const apiKeySession = createProviderSession({
			getProvider: () => apiKeyProvider,
			saveSettings: apiKeySave,
			assertCurrent: vi.fn(),
		});

		expect(() => apiKeySession.assertCurrent()).not.toThrow();
		expect(apiKeySession.provider.auth).toEqual(apiKeyProvider.auth);
		expect(apiKeySession.provider.oauth).toEqual(refreshedTokens);
		await expect(apiKeySession.refreshTokens(refreshedTokens)).rejects.toBeInstanceOf(
			ClassificationStateError
		);
		expect(apiKeySave).not.toHaveBeenCalled();
		expect(apiKeyProvider.auth).toEqual({ type: 'apiKey', apiKey: 'api-key-secret' });
		expect(apiKeyProvider.oauth).toEqual(refreshedTokens);

		codexSave.resolve();
		await refresh;
	});

	it('does not persist flat OAuth credentials with a malformed legacy auth type', async () => {
		const provider = oauthProvider();
		provider.auth = undefined;
		provider.authType = 'apiKey';
		provider.oauth = { ...initialTokens };
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const session = createProviderSession({
			getProvider: () => provider,
			saveSettings,
			assertCurrent: vi.fn(),
		});

		await expect(session.refreshTokens(refreshedTokens)).rejects.toBeInstanceOf(
			ClassificationStateError
		);
		expect(saveSettings).not.toHaveBeenCalled();
		expect(provider.auth).toBeUndefined();
		expect(provider.authType).toBe('apiKey');
		expect(provider.oauth).toEqual(initialTokens);
	});

	it('restores still-owned credentials after a failed save while preserving unrelated edits', async () => {
		const provider = oauthProvider();
		const save = deferred<void>();
		const context = {
			getProvider: () => provider,
			saveSettings: () => save.promise,
			assertCurrent: vi.fn(),
		};
		const session = createProviderSession(context);
		const refresh = session.refreshTokens(refreshedTokens);
		provider.baseUrl = 'https://user-edited.invalid/v2';
		provider.models[0].name = 'User-edited model';

		save.reject(new Error('sensitive save failure'));
		await expect(refresh).rejects.toBeInstanceOf(ClassificationStateError);
		expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toEqual(initialTokens);
		expect(provider.baseUrl).toBe('https://user-edited.invalid/v2');
		expect(provider.models[0].name).toBe('User-edited model');
		expect(() => createProviderSession(context)).not.toThrow();
	});

	it('does not restore credentials explicitly replaced while saving', async () => {
		const provider = oauthProvider();
		const save = deferred<void>();
		const context = {
			getProvider: () => provider,
			saveSettings: () => save.promise,
			assertCurrent: vi.fn(),
		};
		const session = createProviderSession(context);
		const refresh = session.refreshTokens(refreshedTokens);
		const userTokens = { ...initialTokens, accessToken: 'user-replaced-access-secret' };
		provider.auth = { type: 'oauth', oauth: userTokens };

		save.reject(new Error('sensitive save failure'));
		await expect(refresh).rejects.toBeInstanceOf(ClassificationStateError);
		expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toBe(userTokens);
		const userSession = createProviderSession(context);
		expect(userSession.provider.auth?.type === 'oauth' && userSession.provider.auth.oauth).toEqual(
			userTokens
		);
	});

	it('preserves the entire credential bundle after an in-place user edit', async () => {
		const provider = oauthProvider();
		const save = deferred<void>();
		const context = {
			getProvider: () => provider,
			saveSettings: () => save.promise,
			assertCurrent: vi.fn(),
		};
		const session = createProviderSession(context);
		const refresh = session.refreshTokens(refreshedTokens);
		if (provider.auth?.type !== 'oauth') throw new Error('Expected OAuth provider');
		provider.auth.oauth.accessToken = 'user-edited-access-secret';
		expect(() => createProviderSession(context)).toThrow(ClassificationStateError);

		save.reject(new Error('sensitive save failure'));
		await expect(refresh).rejects.toBeInstanceOf(ClassificationStateError);
		expect(provider.auth.oauth).toEqual({
			...refreshedTokens,
			accessToken: 'user-edited-access-secret',
		});
		expect(() => createProviderSession(context)).not.toThrow();
	});

	it('does not restore tokens into a replacement provider after a failed save', async () => {
		let provider = oauthProvider();
		const original = provider;
		const save = deferred<void>();
		const context = {
			getProvider: () => provider,
			saveSettings: () => save.promise,
			assertCurrent: vi.fn(),
		};
		const session = createProviderSession(context);
		const refresh = session.refreshTokens(refreshedTokens);
		provider = { ...oauthProvider(), baseUrl: 'https://replacement.invalid/v2' };

		save.reject(new Error('sensitive save failure'));
		await expect(refresh).rejects.toBeInstanceOf(ClassificationStateError);
		expect(original.auth?.type === 'oauth' && original.auth.oauth).toEqual(refreshedTokens);
		expect(provider.baseUrl).toBe('https://replacement.invalid/v2');
		expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toEqual(initialTokens);
		expect(() => createProviderSession(context)).not.toThrow();
	});

	it('releases refresh ownership when post-save currentness validation fails', async () => {
		const provider = oauthProvider();
		const save = deferred<void>();
		let current = true;
		const context = {
			getProvider: () => provider,
			saveSettings: () => save.promise,
			assertCurrent: () => {
				if (!current) throw new ClassificationStateError('operation-revoked');
			},
		};
		const session = createProviderSession(context);
		const refresh = session.refreshTokens(refreshedTokens);
		current = false;
		save.resolve();
		await expect(refresh).rejects.toBeInstanceOf(ClassificationStateError);

		current = true;
		expect(() => createProviderSession(context)).not.toThrow();
	});

	it('refreshes the existing legacy OAuth shape without adding a unified auth key', async () => {
		const provider = oauthProvider();
		provider.auth = undefined;
		provider.authType = 'oauth';
		provider.oauth = { ...initialTokens };
		const session = createProviderSession({
			getProvider: () => provider,
			saveSettings: vi.fn().mockResolvedValue(undefined),
			assertCurrent: vi.fn(),
		});

		await session.refreshTokens(refreshedTokens);
		expect(provider.oauth).toEqual(refreshedTokens);
		expect(provider.auth).toBeUndefined();
	});

	it('rejects account switches and unified API keys even when stale legacy OAuth exists', async () => {
		const mismatch = oauthProvider();
		const saveMismatch = vi.fn().mockResolvedValue(undefined);
		const mismatchSession = createProviderSession({
			getProvider: () => mismatch,
			saveSettings: saveMismatch,
			assertCurrent: vi.fn(),
		});
		await expect(
			mismatchSession.refreshTokens({ ...refreshedTokens, accountId: 'another-account' })
		).rejects.toBeInstanceOf(ClassificationStateError);
		expect(mismatch.auth?.type === 'oauth' && mismatch.auth.oauth).toEqual(initialTokens);
		expect(saveMismatch).not.toHaveBeenCalled();

		const apiKeyProvider = oauthProvider();
		apiKeyProvider.auth = { type: 'apiKey', apiKey: 'api-key-secret' };
		apiKeyProvider.oauth = { ...initialTokens };
		const saveApiKey = vi.fn().mockResolvedValue(undefined);
		const apiKeySession = createProviderSession({
			getProvider: () => apiKeyProvider,
			saveSettings: saveApiKey,
			assertCurrent: vi.fn(),
		});
		await expect(apiKeySession.refreshTokens(refreshedTokens)).rejects.toBeInstanceOf(
			ClassificationStateError
		);
		expect(apiKeyProvider.auth).toEqual({ type: 'apiKey', apiKey: 'api-key-secret' });
		expect(apiKeyProvider.oauth).toEqual(initialTokens);
		expect(saveApiKey).not.toHaveBeenCalled();
	});
});

describe('model test session', () => {
	it('forwards refresh and request options and permits testing a non-selected provider/model', async () => {
		const provider = oauthProvider();
		const onTokenRefresh: OnTokenRefreshCallback = vi.fn().mockResolvedValue(undefined);
		const assertCurrent = vi.fn();
		const options: HttpRequestOptions = {
			deadline: Date.now() + 30_000,
			assertCurrent,
		};

		await expect(testModel(provider, 'model-a', onTokenRefresh, options)).resolves.toBe(true);
		expect(callAPI).toHaveBeenCalledWith(
			COMMON_CONSTANTS.VERIFY_CONNECTION_SYSTEM_PROMPT,
			COMMON_CONSTANTS.VERIFY_CONNECTION_USER_PROMPT,
			provider,
			'model-a',
			undefined,
			onTokenRefresh,
			options
		);

		const fixture = modelPlugin(provider);
		await modelAction(fixture.plugin)();
		const requestOptions = callAPI.mock.calls[1][6] as HttpRequestOptions;
		expect(requestOptions.deadline).toBeGreaterThan(Date.now());
		expect(requestOptions.deadline).toBeLessThanOrEqual(Date.now() + 60_000);
		expect(requestOptions.assertCurrent).toEqual(expect.any(Function));
		expect(() => requestOptions.assertCurrent?.()).not.toThrow();
		expect(fixture.show).toHaveBeenCalledWith('model_test_success', { name: 'Model A' });
	});

	it('does not request or refresh credentials when the tested provider name is duplicated', async () => {
		const first = oauthProvider();
		const second = { ...oauthProvider(), baseUrl: 'https://second.invalid/v1' };
		const fixture = modelPlugin([first, second]);

		await modelAction(fixture.plugin, 1)();

		expect(callAPI).not.toHaveBeenCalled();
		expect(fixture.saveSettings).not.toHaveBeenCalled();
		expect(first.auth?.type === 'oauth' && first.auth.oauth).toEqual(initialTokens);
		expect(second.auth?.type === 'oauth' && second.auth.oauth).toEqual(initialTokens);
		expect(fixture.show).toHaveBeenCalledWith('model_test_error', {
			message: 'The connection test failed. Check the provider configuration.',
		});
	});

	it.each(['Select', 'Delete'] as const)(
		'rejects a stale %s row callback after its provider is replaced',
		async (action) => {
			const provider = oauthProvider();
			const fixture = modelPlugin(provider);
			if (action === 'Delete') vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
			const callback = modelRowAction(fixture.plugin, action, 0, fixture.onRefresh);
			fixture.state.settings.providers[0] = oauthProvider();

			await callback();

			expect(fixture.state.settings.selectedProvider).toBe('A different provider');
			expect(fixture.state.settings.selectedModel).toBe('a different model');
			expect(provider.models).toEqual([{ id: 'model-a', name: 'Model A' }]);
			expect(fixture.saveSettings).not.toHaveBeenCalled();
			expect(fixture.onRefresh).not.toHaveBeenCalled();
		}
	);

	it('rejects inactive selection, deletion, and edit callbacks before mutation', async () => {
		const provider = oauthProvider();
		const fixture = modelPlugin(provider);
		const select = modelRowAction(fixture.plugin, 'Select', 0, fixture.onRefresh);
		const deletion = modelRowAction(fixture.plugin, 'Delete', 0, fixture.onRefresh);
		const onSave = modelSaveAction(fixture.plugin);
		fixture.state.active = false;

		await select();
		await deletion();
		await onSave({
			provider: 'Codex',
			model: { id: 'model-b', name: 'Model B' },
			isEdit: true,
			oldModel: { model: 'model-a', provider: 'Codex' },
		});

		expect(provider.models).toEqual([{ id: 'model-a', name: 'Model A' }]);
		expect(fixture.state.settings.selectedProvider).toBe('A different provider');
		expect(fixture.state.settings.selectedModel).toBe('a different model');
		expect(fixture.saveSettings).not.toHaveBeenCalled();
		expect(fixture.onRefresh).not.toHaveBeenCalled();
	});

	it.each(['selection', 'deletion', 'edit'] as const)(
		'suppresses refresh when the plugin unloads while saving a %s',
		async (operation) => {
			const provider = oauthProvider();
			const fixture = modelPlugin(provider);
			const save = deferred<void>();
			fixture.saveSettings.mockImplementation(() => save.promise);
			let pending: void | Promise<void>;
			if (operation === 'selection') {
				pending = modelRowAction(fixture.plugin, 'Select', 0, fixture.onRefresh)();
			} else if (operation === 'deletion') {
				vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
				pending = modelRowAction(fixture.plugin, 'Delete', 0, fixture.onRefresh)();
			} else {
				const onSave = modelSaveAction(fixture.plugin);
				pending = onSave({
					provider: 'Codex',
					model: { id: 'model-b', name: 'Model B' },
					isEdit: true,
					oldModel: { model: 'model-a', provider: 'Codex' },
				});
			}
			expect(fixture.saveSettings).toHaveBeenCalledOnce();

			fixture.state.active = false;
			save.resolve();
			await pending;

			expect(fixture.onRefresh).not.toHaveBeenCalled();
		}
	);

	it('registers modal close with plugin lifecycle cleanup', () => {
		const fixture = modelPlugin(oauthProvider());

		modelRowAction(fixture.plugin, 'Edit')();

		expect(fixture.state.register).toHaveBeenCalledOnce();
		expect(fixture.state.cleanups).toHaveLength(1);
		expect(modelModalCloses).toHaveLength(1);
		fixture.state.cleanups[0]();
		expect(modelModalCloses[0]).toHaveBeenCalledOnce();
	});

	it('deletes a model from the captured provider identity, not another duplicate-name profile', async () => {
		const first = { ...oauthProvider(), models: [{ id: 'shared-model', name: 'First row' }] };
		const second = { ...oauthProvider(), models: [{ id: 'shared-model', name: 'Second row' }] };
		const fixture = modelPlugin([first, second]);
		fixture.state.settings.selectedProvider = 'Codex';
		fixture.state.settings.selectedModel = 'shared-model';
		vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

		await modelRowAction(fixture.plugin, 'Delete', 1)();

		expect(first.models).toEqual([{ id: 'shared-model', name: 'First row' }]);
		expect(second.models).toEqual([]);
		expect(fixture.state.settings.selectedProvider).toBe('Codex');
		expect(fixture.state.settings.selectedModel).toBe('shared-model');
		expect(fixture.saveSettings).toHaveBeenCalledOnce();
	});

	it('does not partially move a model when the destination name is duplicated', async () => {
		const source = oauthProvider();
		const firstDestination = { ...oauthProvider(), name: 'Destination', models: [] };
		const secondDestination = {
			...oauthProvider(),
			name: 'Destination',
			baseUrl: 'https://second-destination.invalid/v1',
			models: [],
		};
		const fixture = modelPlugin([source, firstDestination, secondDestination]);
		const onSave = modelSaveAction(fixture.plugin);

		await onSave({
			provider: 'Destination',
			model: { id: 'model-moved', name: 'Moved model' },
			isEdit: true,
			oldModel: { model: 'model-a', provider: 'Codex' },
		});

		expect(source.models).toEqual([{ id: 'model-a', name: 'Model A' }]);
		expect(firstDestination.models).toEqual([]);
		expect(secondDestination.models).toEqual([]);
		expect(fixture.saveSettings).not.toHaveBeenCalled();
	});

	it('does not move a model from an ambiguous source profile', async () => {
		const source = oauthProvider();
		const duplicateSource = {
			...oauthProvider(),
			baseUrl: 'https://second-source.invalid/v1',
		};
		const destination = { ...oauthProvider(), name: 'Destination', models: [] };
		const fixture = modelPlugin([source, duplicateSource, destination]);
		const onSave = modelSaveAction(fixture.plugin);

		await onSave({
			provider: 'Destination',
			model: { id: 'model-moved', name: 'Moved model' },
			isEdit: true,
			oldModel: { model: 'model-a', provider: 'Codex' },
		});

		expect(source.models).toEqual([{ id: 'model-a', name: 'Model A' }]);
		expect(duplicateSource.models).toEqual([{ id: 'model-a', name: 'Model A' }]);
		expect(destination.models).toEqual([]);
		expect(fixture.saveSettings).not.toHaveBeenCalled();
	});

	it('does not move a model to a same-name replacement target opened by a stale modal', async () => {
		const source = oauthProvider();
		const openedTarget = { ...oauthProvider(), name: 'Destination', models: [] };
		const fixture = modelPlugin([source, openedTarget]);
		const onSave = modelSaveAction(fixture.plugin);
		const replacementTarget = {
			...oauthProvider(),
			name: 'Destination',
			baseUrl: 'https://replacement.invalid/v1',
			models: [],
		};
		fixture.state.settings.providers[1] = replacementTarget;

		await onSave({
			provider: 'Destination',
			model: { id: 'model-moved', name: 'Moved model' },
			isEdit: true,
			oldModel: { model: 'model-a', provider: 'Codex' },
		});

		expect(source.models).toEqual([{ id: 'model-a', name: 'Model A' }]);
		expect(openedTarget.models).toEqual([]);
		expect(replacementTarget.models).toEqual([]);
		expect(fixture.saveSettings).not.toHaveBeenCalled();
	});

	it('does not show success until token persistence completes', async () => {
		const provider = oauthProvider();
		const fixture = modelPlugin(provider);
		const save = deferred<void>();
		fixture.saveSettings.mockImplementation(() => save.promise);
		callAPI.mockImplementation(async (...args: unknown[]) => {
			await (args[5] as OnTokenRefreshCallback)(refreshedTokens);
			return { tags: [] };
		});

		const completion = modelAction(fixture.plugin)();
		expect(fixture.saveSettings).toHaveBeenCalledOnce();
		expect(fixture.show).not.toHaveBeenCalled();
		expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toEqual(refreshedTokens);

		save.resolve();
		await completion;
		expect(fixture.show).toHaveBeenCalledWith('model_test_success', { name: 'Model A' });
	});

	it.each(['edited', 'replaced', 'deleted'] as const)(
		'does not write over a provider %s during the test request',
		async (change) => {
			const provider = oauthProvider();
			const fixture = modelPlugin(provider);
			const response = deferred<{ tags: string[] }>();
			callAPI.mockReturnValue(response.promise);
			const completion = modelAction(fixture.plugin)();
			const refresh = callAPI.mock.calls[0][5] as OnTokenRefreshCallback;

			if (change === 'edited') provider.baseUrl = 'https://user-edited.invalid/v2';
			if (change === 'replaced') {
				fixture.state.settings.providers[0] = {
					...oauthProvider(),
					baseUrl: 'https://user-replacement.invalid/v2',
				};
			}
			if (change === 'deleted') fixture.state.settings.providers.splice(0, 1);

			await expect(refresh(refreshedTokens)).rejects.toBeInstanceOf(ClassificationStateError);
			expect(fixture.saveSettings).not.toHaveBeenCalled();
			response.resolve({ tags: [] });
			await completion;
			expect(fixture.show).toHaveBeenCalledWith('model_test_error', {
				message: 'The connection test failed. Check the provider configuration.',
			});
			if (change === 'edited') {
				expect(provider.baseUrl).toBe('https://user-edited.invalid/v2');
				expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toEqual(initialTokens);
			}
			if (change === 'replaced') {
				expect(fixture.state.settings.providers[0].baseUrl).toBe(
					'https://user-replacement.invalid/v2'
				);
				expect(
					fixture.state.settings.providers[0].auth?.type === 'oauth' &&
						fixture.state.settings.providers[0].auth.oauth
				).toEqual(initialTokens);
			}
			expect(JSON.stringify(fixture.state.settings.providers)).not.toContain(
				'refreshed-access-secret'
			);
		}
	);

	it.each(['edited', 'replaced', 'deleted'] as const)(
		'does not overwrite a provider %s while token settings are saving',
		async (change) => {
			const provider = oauthProvider();
			const fixture = modelPlugin(provider);
			const save = deferred<void>();
			fixture.saveSettings.mockImplementation(() => save.promise);
			callAPI.mockImplementation(async (...args: unknown[]) => {
				await (args[5] as OnTokenRefreshCallback)(refreshedTokens);
				return { tags: [] };
			});
			const completion = modelAction(fixture.plugin)();
			expect(fixture.saveSettings).toHaveBeenCalledOnce();

			if (change === 'edited') {
				provider.baseUrl = 'https://user-edited-during-save.invalid/v2';
				provider.auth = {
					type: 'oauth',
					oauth: { ...initialTokens, accessToken: 'user-auth-edit-secret' },
				};
			}
			if (change === 'replaced') {
				fixture.state.settings.providers[0] = {
					...oauthProvider(),
					baseUrl: 'https://user-replacement-during-save.invalid/v2',
					auth: {
						type: 'oauth',
						oauth: { ...initialTokens, accessToken: 'user-replacement-auth-secret' },
					},
				};
			}
			if (change === 'deleted') fixture.state.settings.providers.splice(0, 1);

			save.resolve();
			await completion;
			expect(fixture.show).toHaveBeenCalledWith('model_test_error', {
				message: 'The connection test failed. Check the provider configuration.',
			});
			if (change === 'edited') {
				expect(provider.baseUrl).toBe('https://user-edited-during-save.invalid/v2');
				expect(provider.auth?.type === 'oauth' && provider.auth.oauth.accessToken).toBe(
					'user-auth-edit-secret'
				);
			}
			if (change === 'replaced') {
				expect(fixture.state.settings.providers[0].baseUrl).toBe(
					'https://user-replacement-during-save.invalid/v2'
				);
				expect(
					fixture.state.settings.providers[0].auth?.type === 'oauth' &&
						fixture.state.settings.providers[0].auth.oauth.accessToken
				).toBe('user-replacement-auth-secret');
			}
			expect(fixture.saveSettings).toHaveBeenCalledOnce();
		}
	);

	it('keeps token-save failures out of the model test notice', async () => {
		const provider = oauthProvider();
		const fixture = modelPlugin(provider);
		const canary = 'synthetic-save-secret /private/synthetic-note';
		fixture.saveSettings.mockRejectedValueOnce(new Error(canary));
		callAPI.mockImplementation(async (...args: unknown[]) => {
			await (args[5] as OnTokenRefreshCallback)(refreshedTokens);
			return { tags: [] };
		});

		await modelAction(fixture.plugin)();
		expect(fixture.show).toHaveBeenCalledWith('model_test_error', {
			message: 'The connection test failed. Check the provider configuration.',
		});
		expect(JSON.stringify(fixture.show.mock.calls)).not.toContain(canary);
	});

	it('prevents refresh writes and completion notices after unload', async () => {
		const provider = oauthProvider();
		const fixture = modelPlugin(provider);
		const response = deferred<{ tags: string[] }>();
		callAPI.mockReturnValue(response.promise);
		const completion = modelAction(fixture.plugin)();
		const refresh = callAPI.mock.calls[0][5] as OnTokenRefreshCallback;
		const options = callAPI.mock.calls[0][6] as HttpRequestOptions;

		fixture.state.active = false;
		await expect(refresh(refreshedTokens)).rejects.toBeInstanceOf(ClassificationStateError);
		expect(() => options.assertCurrent?.()).toThrow(ClassificationStateError);
		expect(fixture.saveSettings).not.toHaveBeenCalled();
		response.resolve({ tags: [] });
		await completion;
		expect(fixture.show).not.toHaveBeenCalled();
		expect(provider.auth?.type === 'oauth' && provider.auth.oauth).toEqual(initialTokens);
	});
});
