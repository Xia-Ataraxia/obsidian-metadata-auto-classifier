import { PluginLogger } from '../../src/utils/plugin-logger';
import type { DiagnosticMetrics, LogEvent } from '../../src/utils/plugin-logger';

describe('closed diagnostic allowlist', () => {
	afterEach(() => vi.restoreAllMocks());

	it('retains only known events and finite numeric metrics', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		new PluginLogger().warn('api-error', {
			status: 429,
			attempt: 2,
			count: -1,
			durationMs: Infinity,
			body: 'synthetic-body-secret',
			response: 'synthetic-response-secret',
		} as DiagnosticMetrics);
		expect(spy).toHaveBeenCalledWith('[MAC] warn | api-error | status=429 attempt=2');
	});

	it('never emits arbitrary event strings, errors, paths, or payload properties', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const logger = new PluginLogger();
		logger.error(
			'synthetic-secret /private/synthetic-note' as LogEvent,
			new Error('synthetic-response-secret') as unknown as DiagnosticMetrics
		);
		expect(spy).toHaveBeenCalledWith('[MAC] error | diagnostic');
	});

	it('does not invoke property getters while inspecting metrics', () => {
		const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
		const getter = vi.fn(() => {
			throw new Error('synthetic-secret');
		});
		const metrics = Object.defineProperty({}, 'status', { get: getter });
		new PluginLogger().info('oauth-refreshed', metrics);
		expect(getter).not.toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith('[MAC] info | oauth-refreshed');
	});

	it('handles hostile metric proxies without disclosing exceptions', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const metrics = new Proxy(
			{},
			{
				getOwnPropertyDescriptor() {
					throw new Error('synthetic-secret');
				},
			}
		);
		expect(() => new PluginLogger().error('unexpected-error', metrics)).not.toThrow();
		expect(spy).toHaveBeenCalledWith('[MAC] error | unexpected-error');
	});

	it('keeps diagnostic debugging opt-in without changing the allowlist', () => {
		const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
		new PluginLogger().debug('api-error', { count: 2 });
		expect(spy).not.toHaveBeenCalled();
		new PluginLogger(() => true).debug('api-error', { count: 2 });
		expect(spy).toHaveBeenCalledWith('[MAC] debug | api-error | count=2');
	});
});
