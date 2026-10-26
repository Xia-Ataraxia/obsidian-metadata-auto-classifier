import { toApiErrorNotice } from '../../src/utils/api-error-notice';

describe('toApiErrorNotice', () => {
	it('maps HTTP statuses to calm copy without URLs or bodies', () => {
		expect(toApiErrorNotice(new Error('Request failed, status 401'), 'OpenAI')).toBe(
			'Request failed (401). Check the API key for OpenAI.'
		);
		expect(toApiErrorNotice({ status: 403 }, 'OpenAI')).toBe(
			'Request failed (403). Check the API key for OpenAI.'
		);
		expect(toApiErrorNotice(new Error('Request failed, status 429'), 'OpenAI')).toBe(
			'Rate limited. Try again in a moment.'
		);
		const serverError = toApiErrorNotice(
			new Error('Server error (HTTP 502) from https://api.example.com/v1: {"secret":"body"}'),
			'Gemini'
		);
		expect(serverError).toBe('Gemini is unavailable (502). Try again later.');
		expect(toApiErrorNotice(new Error('Request failed, status 404'), 'Ollama')).toBe(
			'Request to Ollama failed (404).'
		);
	});

	it('prefers reconnect and parse copy over any status in the text', () => {
		const wrapped = Object.assign(new Error('Token refresh failed: invalid_grant'), { status: 401 });
		expect(toApiErrorNotice(wrapped, 'Codex')).toBe('Reconnect your Codex account in settings.');
		expect(
			toApiErrorNotice(new Error('Failed to parse API response. Raw content: HTTP 404 page'), 'Fake')
		).toBe('Fake returned an unexpected response. Try again.');
	});

	it('handles network, parse, and other failures', () => {
		expect(toApiErrorNotice(new Error('net::ERR_CONNECTION_REFUSED'), 'Ollama')).toBe(
			"Couldn't reach Ollama."
		);
		expect(
			toApiErrorNotice(new Error('Failed to parse API response: x. Raw content: note body'), 'Fake')
		).toBe('Fake returned an unexpected response. Try again.');
		expect(toApiErrorNotice(new Error('Unexpected failure with sk-secret123 in text'), 'Fake')).toBe(
			'Request failed. Please try again.'
		);
		expect(
			toApiErrorNotice(new Error('Codex OAuth tokens not found. Please reconnect your account.'), 'Codex')
		).toBe('Reconnect your Codex account in settings.');
		expect(
			toApiErrorNotice(new Error('Codex OAuth tokens incomplete. Please reconnect your account in settings.'), 'Codex')
		).toBe('Reconnect your Codex account in settings.');
		expect(toApiErrorNotice(new Error('Token refresh failed: invalid_grant'), 'Codex')).toBe(
			'Reconnect your Codex account in settings.'
		);
		expect(toApiErrorNotice('boom', 'Fake')).toBe('Request failed. Please try again.');
	});

	it('does not invoke unknown getters or stringifiers', () => {
		const getter = vi.fn(() => { throw new Error('private error'); });
		const stringify = vi.fn(() => { throw new Error('private error'); });
		const error = Object.defineProperties({ toString: stringify }, {
			message: { get: getter },
			status: { get: getter },
		});
		expect(toApiErrorNotice(error, 'OpenAI')).toBe('Request failed. Please try again.');
		expect(getter).not.toHaveBeenCalled();
		expect(stringify).not.toHaveBeenCalled();
	});

	it('handles throwing descriptors without disclosing their exceptions', () => {
		const error = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('private error'); } });
		expect(toApiErrorNotice(error, 'OpenAI')).toBe('Request failed. Please try again.');
	});

	it.each([NaN, Infinity, 99, 600, 401.5])('rejects invalid HTTP status %s', (status) => {
		expect(toApiErrorNotice({ status }, 'OpenAI')).toBe('Request failed. Please try again.');
	});
});
