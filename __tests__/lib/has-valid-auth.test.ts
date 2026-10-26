import { hasValidAuth } from '../../src/utils/lib-utils';

const base = { baseUrl: 'http://x', models: [] };

describe('hasValidAuth', () => {
	it('accepts keyless local providers without an API key (#46)', () => {
		expect(hasValidAuth({ ...base, name: 'Ollama' })).toBe(true);
		expect(hasValidAuth({ ...base, name: 'Ollama', auth: { type: 'apiKey', apiKey: '' } })).toBe(true);
	});

	it('still requires a key for hosted providers', () => {
		expect(hasValidAuth({ ...base, name: 'OpenAI' })).toBe(false);
		expect(hasValidAuth({ ...base, name: 'OpenAI', apiKey: 'sk' })).toBe(true);
		expect(hasValidAuth({ ...base, name: 'OpenAI', auth: { type: 'apiKey', apiKey: 'sk' } })).toBe(true);
	});

	it('requires an access token for oauth providers', () => {
		const oauth = { accessToken: 't', refreshToken: 'r', expiresAt: 1, accountId: 'a' };
		expect(hasValidAuth({ ...base, name: 'Codex', auth: { type: 'oauth', oauth } })).toBe(true);
		expect(hasValidAuth({ ...base, name: 'Codex', authType: 'oauth' })).toBe(false);
		expect(hasValidAuth({ ...base, name: 'Codex', authType: 'oauth', oauth })).toBe(true);
	});
});
