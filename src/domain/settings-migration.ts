import { extractAccountId } from './auth/token-manager';

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withAccountId(oauth: unknown): unknown {
	if (!isRaw(oauth) || typeof oauth.accessToken !== 'string') return oauth;
	if (typeof oauth.accountId === 'string' && oauth.accountId) return oauth;
	try {
		return { ...oauth, accountId: extractAccountId(oauth.accessToken) };
	} catch {
		return oauth;
	}
}

/**
 * Upgrades settings written by earlier releases: moves the legacy top-level
 * `codexConnection` onto the Codex provider and backfills a missing `accountId`.
 */
export function migrateStoredSettings(stored: unknown): unknown {
	if (!isRaw(stored)) return stored;
	const { codexConnection, ...rest } = stored;
	const providers = Array.isArray(rest.providers) ? rest.providers : undefined;
	if (!providers) return rest;

	const migrated = providers.map((provider: unknown) => {
		if (!isRaw(provider)) return provider;
		const legacy = provider.name === 'Codex' && !provider.oauth ? codexConnection : undefined;
		const oauth = withAccountId(provider.oauth ?? legacy);
		if (oauth === provider.oauth) return provider;
		return legacy ? { ...provider, oauth, authType: 'oauth' } : { ...provider, oauth };
	});
	if (migrated.some((provider, index) => provider !== providers[index])) rest.providers = migrated;
	return rest;
}
