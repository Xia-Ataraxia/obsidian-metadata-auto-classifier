import { redactLogPayload, sanitizeErrorMessage, toNoticeMessage } from '../../src/utils/log-redaction';
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

	it('reduces API errors to one short notice line without raw bodies or URLs', () => {
		expect(toNoticeMessage('Request failed, status 401')).toBe('Request failed, status 401');
		expect(
			toNoticeMessage(
				'Failed to parse API response: Unexpected token. Raw content: {"secret":"note body"}'
			)
		).toBe('Failed to parse API response: Unexpected token');
		expect(
			toNoticeMessage('Client error (HTTP 401) from https://api.example.com/v1?key=x: {"error":"bad"}')
		).toBe('Client error (HTTP 401)');
		expect(toNoticeMessage('Bearer abc.def failed')).toBe('[REDACTED] failed');
		const long = toNoticeMessage('x'.repeat(500));
		expect(long).toHaveLength(120);
		expect(long.endsWith('…')).toBe(true);
	});
});
