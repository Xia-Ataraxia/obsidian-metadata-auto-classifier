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

	it('handles network, parse, and other failures', () => {
		expect(toApiErrorNotice(new Error('net::ERR_CONNECTION_REFUSED'), 'Ollama')).toBe(
			"Couldn't reach Ollama."
		);
		expect(
			toApiErrorNotice(new Error('Failed to parse API response: x. Raw content: note body'), 'Fake')
		).toBe('Fake returned an unexpected response. Try again.');
		expect(toApiErrorNotice(new Error('Unexpected failure with sk-secret123 in text'), 'Fake')).toBe(
			'Classification failed. See the console for details.'
		);
		expect(toApiErrorNotice('boom', 'Fake')).toBe('Classification failed. See the console for details.');
	});
});
