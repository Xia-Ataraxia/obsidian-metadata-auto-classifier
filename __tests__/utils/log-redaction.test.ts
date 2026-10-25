import { redactLogPayload, sanitizeErrorMessage } from '../../src/utils/log-redaction';
import { PluginLogger } from '../../src/utils/plugin-logger';

describe('log redaction', () => {
	it('redacts tokens, OAuth secrets, prompt bodies, and note bodies in structured log payloads', () => {
		const payload = redactLogPayload({
			headers: { Authorization: 'Bearer secret-token-value' },
			body: {
				prompt: 'full note body '.repeat(30),
				accessToken: 'access-secret',
				oauth: { refreshToken: 'refresh-secret' },
			},
		});

		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain('secret-token-value');
		expect(serialized).not.toContain('access-secret');
		expect(serialized).not.toContain('refresh-secret');
		expect(serialized).not.toContain('full note body '.repeat(30));
		expect(serialized).toContain('[REDACTED]');
	});

	it('redacts and truncates plugin logger output', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const logger = new PluginLogger('MAC');

		logger.error('failed', {
			accessToken: 'access-secret',
			message: 'provider payload '.repeat(30),
		});

		const output = String(spy.mock.calls[0]?.[0]);
		expect(output).not.toContain('access-secret');
		expect(output).not.toContain('provider payload '.repeat(30));
		expect(output).toContain('[REDACTED]');
		expect(output).toContain('[truncated');
		spy.mockRestore();
	});

	it('sanitizes bearer tokens in error messages', () => {
		expect(sanitizeErrorMessage('failed Bearer abc.def.ghi')).toContain('[REDACTED]');
	});

});
