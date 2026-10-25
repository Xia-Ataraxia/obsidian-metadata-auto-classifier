import { ErrorHandler } from '../../src/utils/ErrorHandler';
import { macLogger } from '../../src/utils/mac-logger';

describe('ErrorHandler', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('logs static API, validation, and unexpected categories only', () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const errorLog = vi.spyOn(macLogger, 'error').mockImplementation(() => {});
		const warningLog = vi.spyOn(macLogger, 'warn').mockImplementation(() => {});

		ErrorHandler.handleAPIError(new Error(canary), `context ${canary}`);
		ErrorHandler.handleValidationError(canary, canary);
		ErrorHandler.handleUnexpectedError(new Error(canary), `context ${canary}`);

		expect(errorLog.mock.calls).toEqual([['api-error'], ['unexpected-error']]);
		expect(warningLog.mock.calls).toEqual([['validation-error']]);
		expect(JSON.stringify([errorLog.mock.calls, warningLog.mock.calls])).not.toContain(canary);
	});

	test('does not inspect malformed error or validation objects', () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const malformed = Object.defineProperties(
			{},
			{
				message: {
					get: () => {
						throw new Error('message getter accessed');
					},
				},
				toString: {
					get: () => {
						throw new Error('toString getter accessed');
					},
				},
			}
		);
		const errorLog = vi.spyOn(macLogger, 'error').mockImplementation(() => {});
		const warningLog = vi.spyOn(macLogger, 'warn').mockImplementation(() => {});

		expect(() => {
			ErrorHandler.handleAPIError({ message: canary, body: canary });
			ErrorHandler.handleUnexpectedError(malformed);
			ErrorHandler.handleUnexpectedError(canary);
			ErrorHandler.handleValidationError(canary, canary);
		}).not.toThrow();

		expect(errorLog.mock.calls).toEqual([
			['api-error'],
			['unexpected-error'],
			['unexpected-error'],
		]);
		expect(warningLog.mock.calls).toEqual([['validation-error']]);
		expect(JSON.stringify([errorLog.mock.calls, warningLog.mock.calls])).not.toContain(canary);
	});

	test('wrapAsync retains its null-on-error contract with a static diagnostic', async () => {
		const errorLog = vi.spyOn(macLogger, 'error').mockImplementation(() => {});
		const canary = new Error('key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH');

		await expect(
			ErrorHandler.wrapAsync(() => Promise.reject(canary), 'private context')
		).resolves.toBeNull();
		expect(errorLog).toHaveBeenCalledWith('unexpected-error');
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain(canary.message);
	});

	test('safeCallback contains thrown errors and logs a static diagnostic', () => {
		const errorLog = vi.spyOn(macLogger, 'error').mockImplementation(() => {});
		const callback = ErrorHandler.safeCallback(() => {
			throw new Error('key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH');
		}, 'private context');

		expect(() => callback()).not.toThrow();
		expect(errorLog).toHaveBeenCalledWith('unexpected-error');
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain('CANARY_KEY');
	});
});
