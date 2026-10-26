import { providerHasAuth } from '../../src/domain/classification-state';
import type { ProviderConfig } from '../../src/types';

const base = { baseUrl: 'http://x', models: [] };
const oauth = { accessToken: 't', refreshToken: 'r', expiresAt: 1, accountId: 'a' };

describe('providerHasAuth for provider connection status', () => {
	it('accepts keyless local providers without an API key (#46)', () => {
		expect(providerHasAuth({ ...base, name: 'Ollama' })).toBe(true);
		expect(providerHasAuth({ ...base, name: 'Ollama', auth: { type: 'apiKey', apiKey: '' } })).toBe(true);
		expect(providerHasAuth({ ...base, name: 'LM Studio', apiKey: '' })).toBe(true);
	});

	it('still requires a key for hosted providers', () => {
		expect(providerHasAuth({ ...base, name: 'OpenAI' })).toBe(false);
		expect(providerHasAuth({ ...base, name: 'OpenAI', apiKey: 'sk' })).toBe(true);
		expect(providerHasAuth({ ...base, name: 'OpenAI', auth: { type: 'apiKey', apiKey: 'sk' } })).toBe(true);
		expect(providerHasAuth({ ...base, name: 'Custom Provider' })).toBe(false);
	});

	it('requires complete credentials for the OAuth backend', () => {
		expect(providerHasAuth({ ...base, name: 'Codex', auth: { type: 'oauth', oauth } })).toBe(true);
		expect(providerHasAuth({ ...base, name: 'Codex', authType: 'oauth' })).toBe(false);
		expect(providerHasAuth({ ...base, name: 'Codex', authType: 'oauth', oauth })).toBe(true);
		expect(providerHasAuth({ ...base, name: 'Codex', apiKey: 'stale-api-key' })).toBe(false);
	});

	it('uses explicit auth ahead of stale legacy mode and credentials', () => {
		const legacy: ProviderConfig = { ...base, name: 'OpenAI', apiKey: 'legacy', auth: undefined };
		expect(providerHasAuth(legacy)).toBe(true);
		expect(providerHasAuth({ ...legacy, auth: { type: 'apiKey', apiKey: 'structured' }, authType: 'oauth' })).toBe(true);
		expect(providerHasAuth({ ...legacy, auth: { type: 'apiKey', apiKey: '' } })).toBe(false);
		expect(providerHasAuth({ ...legacy, auth: null } as unknown as ProviderConfig)).toBe(false);
		expect(providerHasAuth({ ...legacy, authType: 'oauth' })).toBe(false);
	});

	it('does not fall back from incomplete explicit OAuth credentials', () => {
		expect(providerHasAuth({ ...base, name: 'Codex', auth: { type: 'oauth', oauth: { ...oauth, refreshToken: '' } }, oauth })).toBe(false);
	});

	it('never reports an unknown or case-mismatched backend as authenticated', () => {
		expect(providerHasAuth({ ...base, name: 'UnknownProvider', apiKey: 'present' })).toBe(false);
		expect(providerHasAuth({ ...base, name: 'openai', apiKey: 'present' })).toBe(false);
	});
});
