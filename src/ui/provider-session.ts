import type { OAuthTokens, ProviderConfig } from '../types';
import {
	ClassificationStateError,
	copyProvider,
	providerHasAuth,
	sameProvider,
} from '../domain/classification-state';
import { PROVIDER_NAMES } from '../utils/lib-utils';

const pendingRefreshCredentials = new Set<OAuthTokens>();

export interface ProviderSessionContext {
	getProvider: () => ProviderConfig | undefined;
	saveSettings: () => Promise<void>;
	assertCurrent: () => void;
	/** Called when refreshed tokens could not be persisted; they stay in memory for this run. */
	onPersistFailed?: () => void;
}

function selectedOAuth(provider: ProviderConfig): OAuthTokens | undefined {
	if (provider.name !== PROVIDER_NAMES.CODEX || !providerHasAuth(provider)) return undefined;
	if (provider.auth !== undefined)
		return provider.auth?.type === 'oauth' ? provider.auth.oauth : undefined;
	return provider.oauth;
}

function replaceSelectedOAuth(provider: ProviderConfig, tokens: OAuthTokens): boolean {
	if (!selectedOAuth(provider)) return false;
	if (provider.auth?.type === 'oauth') {
		provider.auth.oauth = { ...tokens };
		return true;
	}
	if (provider.auth === undefined) {
		provider.oauth = { ...tokens };
		return true;
	}
	return false;
}

function carriesPendingCredential(tokens: OAuthTokens | undefined): boolean {
	if (!tokens) return false;
	for (const pending of pendingRefreshCredentials) {
		if (
			tokens.accessToken === pending.accessToken ||
			tokens.refreshToken === pending.refreshToken
		) {
			return true;
		}
	}
	return false;
}

export function createProviderSession(context: ProviderSessionContext) {
	context.assertCurrent();
	const configured = context.getProvider();
	if (!configured) throw new ClassificationStateError('provider-changed');
	if (carriesPendingCredential(selectedOAuth(configured))) {
		throw new ClassificationStateError('provider-changed');
	}
	let expected = copyProvider(configured);
	const provider = copyProvider(expected);

	const assertCurrent = (): void => {
		context.assertCurrent();
		const current = context.getProvider();
		if (
			carriesPendingCredential(selectedOAuth(provider)) ||
			carriesPendingCredential(selectedOAuth(expected)) ||
			carriesPendingCredential(current ? selectedOAuth(current) : undefined) ||
			!sameProvider(current, expected)
		) {
			throw new ClassificationStateError('provider-changed');
		}
	};

	const refreshTokens = async (tokens: OAuthTokens): Promise<void> => {
		context.assertCurrent();
		const live = context.getProvider();
		const liveTokens = live && selectedOAuth(live);
		// Another session already persisted this exact refresh result (single-flight refresh).
		if (live && liveTokens?.accessToken === tokens.accessToken && liveTokens.refreshToken === tokens.refreshToken) {
			expected = copyProvider(live);
			return;
		}
		assertCurrent();
		const current = context.getProvider();
		const previousTokens = current && selectedOAuth(current);
		if (!current || !previousTokens || tokens.accountId !== previousTokens.accountId) {
			throw new ClassificationStateError('provider-changed');
		}

		const refreshed = { ...tokens };
		const next = copyProvider(expected);
		if (!replaceSelectedOAuth(next, refreshed) || !replaceSelectedOAuth(current, refreshed)) {
			throw new ClassificationStateError('provider-changed');
		}
		pendingRefreshCredentials.add(refreshed);
		try {
			// The old refresh token is already consumed server-side: never roll back to it.
			try {
				await context.saveSettings();
			} catch {
				try {
					await context.saveSettings();
				} catch {
					context.onPersistFailed?.();
				}
			}
			context.assertCurrent();
			if (!sameProvider(context.getProvider(), next)) {
				throw new ClassificationStateError('provider-changed');
			}
			expected = next;
		} finally {
			pendingRefreshCredentials.delete(refreshed);
		}
	};

	return { provider, assertCurrent, refreshTokens };
}
