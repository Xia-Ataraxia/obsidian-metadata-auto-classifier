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
}

function selectedOAuth(provider: ProviderConfig): OAuthTokens | undefined {
	if (provider.name !== PROVIDER_NAMES.CODEX || !providerHasAuth(provider)) return undefined;
	if (provider.auth !== undefined)
		return provider.auth?.type === 'oauth' ? provider.auth.oauth : undefined;
	return provider.oauth;
}

function selectedOAuthOwner(provider: ProviderConfig): object | undefined {
	if (!selectedOAuth(provider)) return undefined;
	return provider.auth ?? provider;
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

function restoreOwnedOAuth(
	provider: ProviderConfig,
	owner: object,
	written: OAuthTokens,
	refreshed: OAuthTokens,
	previous: OAuthTokens
): void {
	const current = selectedOAuth(provider);
	if (selectedOAuthOwner(provider) !== owner || current !== written) return;
	// Any credential edit transfers ownership of the entire bundle.
	if (
		current.accessToken !== refreshed.accessToken ||
		current.refreshToken !== refreshed.refreshToken ||
		current.expiresAt !== refreshed.expiresAt ||
		current.accountId !== refreshed.accountId
	)
		return;
	replaceSelectedOAuth(provider, previous);
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
		assertCurrent();
		const current = context.getProvider();
		const previousTokens = current && selectedOAuth(current);
		if (!current || !previousTokens || tokens.accountId !== previousTokens.accountId) {
			throw new ClassificationStateError('provider-changed');
		}

		const refreshed = { ...tokens };
		const previous = { ...previousTokens };
		const next = copyProvider(expected);
		const owner = selectedOAuthOwner(current);
		if (!owner) throw new ClassificationStateError('provider-changed');
		if (!replaceSelectedOAuth(next, refreshed) || !replaceSelectedOAuth(current, refreshed)) {
			throw new ClassificationStateError('provider-changed');
		}
		const written = selectedOAuth(current);
		if (!written) throw new ClassificationStateError('provider-changed');
		pendingRefreshCredentials.add(refreshed);
		try {
			try {
				await context.saveSettings();
			} catch {
				if (context.getProvider() === current) {
					restoreOwnedOAuth(current, owner, written, refreshed, previous);
				}
				throw new ClassificationStateError('provider-changed');
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
