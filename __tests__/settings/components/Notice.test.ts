import { Notice as SettingsNotice } from 'settings/components/Notice';
import { Notice } from 'obsidian';
import { PluginNotices } from '../../../src/ui/plugin-notices';

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, setIcon: vi.fn() };
});

(global as any).window = global;

describe('Notice', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('error shows a safe generic notice and logs a static reason', () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});

		SettingsNotice.error(new Error(canary));
		SettingsNotice.error(canary);
		SettingsNotice.error({ message: canary, body: canary });

		expect(Notice).toHaveBeenCalledWith('❌ An error occurred.', 5000);
		expect(Notice).toHaveBeenCalledTimes(3);
		expect(log).toHaveBeenCalledWith('[MAC] An error occurred.');
		expect(log).toHaveBeenCalledTimes(3);
		expect(JSON.stringify([Notice.mock.calls, log.mock.calls])).not.toContain(canary);
	});

	test('error does not inspect malformed values', () => {
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
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(() => SettingsNotice.error(malformed)).not.toThrow();
		expect(Notice).toHaveBeenCalledWith('❌ An error occurred.', 5000);
		expect(log).toHaveBeenCalledWith('[MAC] An error occurred.');
	});

	test('validation errors retain a safe static category', () => {
		const canary = 'private validation text';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});

		SettingsNotice.validationError(canary, canary);

		expect(SettingsNotice.formatValidationError(canary, canary)).toBe(
			'[Validation] Validation failed.'
		);
		expect(Notice).toHaveBeenCalledWith('❌ [Validation] Validation failed.', 5000);
		expect(log).toHaveBeenCalledWith('[MAC] [Validation] Validation failed.');
		expect(JSON.stringify([Notice.mock.calls, log.mock.calls])).not.toContain(canary);
	});

	test('success shows success notice', () => {
		SettingsNotice.success('ok');
		expect(Notice).toHaveBeenCalledWith('ok', 3000);
	});

	test('startProgress and endProgress manage notice', () => {
		vi.useFakeTimers();
		const notice: any = SettingsNotice.startProgress('Task');
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Task'), 0);
		expect(notice.interval).toBeDefined();
		vi.advanceTimersByTime(200);
		expect(notice.setMessage).toHaveBeenCalled();
		SettingsNotice.endProgress(notice);
		expect(notice.hide).toHaveBeenCalled();
		vi.useRealTimers();
	});

	test('withProgress wraps async function with progress notice', async () => {
		vi.useFakeTimers();
		const fn = vi.fn().mockResolvedValue('done');
		const promise = SettingsNotice.withProgress('file.md', 'tags', fn);
		const result = await promise;
		expect(result).toBe('done');
		expect(fn).toHaveBeenCalled();
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	test('withProgress cleans up after a rejected operation without changing its rejection', async () => {
		vi.useFakeTimers();
		const error = new Error('key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH');
		const promise = SettingsNotice.withProgress('file.md', 'tags', () => Promise.reject(error));
		const progressNotice = (Notice as any).mock.results[0].value;

		await expect(promise).rejects.toBe(error);
		expect(progressNotice.hide).toHaveBeenCalled();
		vi.useRealTimers();
	});

	test('plugin notice mute failures log only a static message', async () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const saveSettings = vi.fn().mockRejectedValue(new Error(canary));
		const pluginNotices = new PluginNotices({ settings: {}, saveSettings }, {}, 'CANARY_PREFIX');
		let onClick: (() => void) | undefined;
		const button = {
			className: '',
			type: '',
			setAttribute: vi.fn(),
			addEventListener: vi.fn((_event: string, callback: () => void) => {
				onClick = callback;
			}),
		};
		vi.stubGlobal('document', { createElement: vi.fn(() => button) });
		const muteButton = (pluginNotices as any).createMuteButton('notice-id');

		onClick?.();
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.'));

		expect(muteButton).toBe(button);
		expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.');
		expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
		expect(JSON.stringify(log.mock.calls)).not.toContain('CANARY_PREFIX');
		vi.unstubAllGlobals();
	});
});
