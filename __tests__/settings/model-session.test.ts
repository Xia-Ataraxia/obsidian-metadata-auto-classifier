import { App } from 'obsidian';
import type { OAuthTokens, ProviderConfig } from '../../src/types';
import { COMMON_CONSTANTS } from '../../src/domain/constants';
import { ClassificationStateError } from '../../src/domain/classification-state';
import { ModelSection } from '../../src/ui/settings/ModelSection';
import { Setting } from '../../src/ui/settings/components/Setting';
import { testModel } from '../../src/ui/provider-api';
import { createProviderSession } from '../../src/ui/provider-session';
import type { HttpRequestOptions } from '../../src/ui/request';
import type AutoClassifierPlugin from '../../src/main';
import type { OnTokenRefreshCallback } from '../../src/types';

const { callAPI } = vi.hoisted(() => ({ callAPI: vi.fn() }));
vi.mock('../../src/ui/UnifiedProvider', () => ({
	UnifiedProvider: class {
		callAPI = callAPI;
	},
}));
vi.mock('../../src/ui/settings/components/Setting', () => ({ Setting: { create: vi.fn() } }));
vi.mock('../../src/ui/settings/modals/ModelModal', () => ({ ModelModal: class {} }));

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
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function oauthProvider(): ProviderConfig {
	return {
		name: 'Codex',
		baseUrl: 'https://example.invalid/v1',
		models: [{ id: 'model-a', name: 'Model A' }],
		auth: { type: 'oauth', oauth: { ...initialTokens } },
	};
}

function modelAction(plugin: AutoClassifierPlugin): () => Promise<void> {
	const container = { createEl: vi.fn() };
	container.createEl.mockReturnValue(container);
	new ModelSection(plugin, new App(), vi.fn()).render(
		container as unknown as HTMLElement,
		plugin.settings.providers,
		'not-the-tested-model'
	);
	const testButton = vi
		.mocked(Setting.create)
		.mock.calls.flatMap(([, props]) => props.buttons ?? [])
		.find((button) => button.text === 'Test');
	if (!testButton) throw new Error('Test button was not rendered');
	return testButton.onClick;
}

function modelPlugin(provider: ProviderConfig) {
	const state = {
		active: true,
		settings: {
			providers: [provider],
			selectedProvider: 'A different provider',
			selectedModel: 'a different model',
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
		notices: { show: vi.fn() },
	};
	const plugin = {
		settings: state.settings,
		isActive: () => state.active,
		saveSettings: state.saveSettings,
		notices: state.notices,
	} as unknown as AutoClassifierPlugin;
	return { state, plugin, saveSettings: state.saveSettings, show: state.notices.show };
}

beforeEach(() => {
	vi.clearAllMocks();
	callAPI.mockReset().mockResolvedValue({ tags: [] });
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
