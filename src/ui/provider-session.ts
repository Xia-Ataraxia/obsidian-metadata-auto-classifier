import type { OAuthTokens, ProviderConfig } from '../types';
import {
	ClassificationStateError,
	copyProvider,
	sameProvider,
} from '../domain/classification-state';

export interface ProviderSessionContext {
	getProvider: () => ProviderConfig | undefined;
	saveSettings: () => Promise<void>;
	assertCurrent: () => void;
}

function selectedOAuth(provider: ProviderConfig): OAuthTokens | undefined {
	if (provider.auth) return provider.auth.type === 'oauth' ? provider.auth.oauth : undefined;
	if (provider.authType === 'apiKey') return undefined;
	return provider.oauth;
}

function replaceSelectedOAuth(provider: ProviderConfig, tokens: OAuthTokens): boolean {
	if (provider.auth?.type === 'oauth') {
		provider.auth.oauth = { ...tokens };
		return true;
	}
	if (!provider.auth && provider.authType !== 'apiKey' && provider.oauth) {
		provider.oauth = { ...tokens };
		return true;
	}
	return false;
}

export function createProviderSession(context: ProviderSessionContext) {
	context.assertCurrent();
	const configured = context.getProvider();
	if (!configured) throw new ClassificationStateError('provider-changed');
	let expected = copyProvider(configured);
	const provider = copyProvider(expected);

	const assertCurrent = (): void => {
		context.assertCurrent();
		if (!sameProvider(context.getProvider(), expected)) {
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

		const next = copyProvider(expected);
		if (!replaceSelectedOAuth(next, tokens) || !replaceSelectedOAuth(current, tokens)) {
			throw new ClassificationStateError('provider-changed');
		}
		try {
			await context.saveSettings();
		} catch {
			throw new ClassificationStateError('provider-changed');
		}
		context.assertCurrent();
		if (!sameProvider(context.getProvider(), next)) {
			throw new ClassificationStateError('provider-changed');
		}
		expected = next;
	};

	return { provider, assertCurrent, refreshTokens };
}
