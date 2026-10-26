import { migrateStoredSettings } from '../../src/domain/settings-migration';

const jwt = (claims: object) =>
	['e30', btoa(JSON.stringify(claims)).replace(/=+$/, ''), 'c2ln'].join('.');
const access = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } });

describe('migrateStoredSettings', () => {
	it('moves legacy codexConnection onto the Codex provider', () => {
		const legacy = { accessToken: access, refreshToken: 'r', expiresAt: 1, accountId: 'acct_1' };
		const out = migrateStoredSettings({
			codexConnection: legacy,
			providers: [{ name: 'Codex' }, { name: 'Other' }],
		}) as { providers: Array<Record<string, unknown>> } & Record<string, unknown>;
		expect(out.codexConnection).toBeUndefined();
		expect(out.providers[0]).toMatchObject({ authType: 'oauth', oauth: legacy });
		expect(out.providers[1]).toEqual({ name: 'Other' });
	});

	it('backfills a missing accountId from the access token', () => {
		const out = migrateStoredSettings({
			providers: [{ name: 'Codex', oauth: { accessToken: access, refreshToken: 'r', expiresAt: 1 } }],
		}) as { providers: Array<{ oauth: { accountId: string } }> };
		expect(out.providers[0]!.oauth.accountId).toBe('acct_1');
	});

	it('leaves unreadable tokens and non-objects alone', () => {
		expect(migrateStoredSettings(null)).toBeNull();
		const bad = { name: 'Codex', oauth: { accessToken: 'x', refreshToken: 'r', expiresAt: 1 } };
		expect(migrateStoredSettings({ providers: [bad] })).toEqual({ providers: [bad] });
	});
});
