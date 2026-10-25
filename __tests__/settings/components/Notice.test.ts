import { Notice as SettingsNotice } from 'settings/components/Notice';
import { Notice } from 'obsidian';
import { PluginNotices } from '../../../src/ui/plugin-notices';

const buttonComponents = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	class ButtonComponentBoundary {
		buttonEl: any;
		private callback?: () => void;

		constructor(containerEl: any) {
			this.buttonEl = containerEl.ownerDocument.createElement('button');
			this.buttonEl.click = () => this.callback?.();
			containerEl.appendChild(this.buttonEl);
			buttonComponents.instances.push(this);
		}

		setButtonText(text: string): this {
			this.buttonEl.textContent = text;
			return this;
		}

		setClass(className: string): this {
			this.buttonEl.className = className;
			return this;
		}

		setIcon(icon: string): this {
			this.buttonEl.icon = icon;
			return this;
		}

		onClick(callback: () => void): this {
			this.callback = callback;
			return this;
		}
	}

	return { ...actual, ButtonComponent: ButtonComponentBoundary };
});

(global as any).window = global;

function createObsidianDocumentBoundary(): any {
	let context: any;
	const createElement = (tagName: string) => {
		const element: any = {
			tagName,
			ownerDocument: context,
			children: [],
			className: '',
			textContent: '',
			attributes: {} as Record<string, string>,
			appendChild(child: any) {
				this.children.push(child);
				return child;
			},
			createEl(childTagName: string, options: { cls?: string; text?: string } = {}) {
				const child = context.createElement(childTagName);
				child.className = options.cls ?? '';
				child.textContent = options.text ?? '';
				return this.appendChild(child);
			},
			createDiv(options: { cls?: string; text?: string } = {}) {
				return this.createEl('div', options);
			},
			setAttribute(name: string, value: string) {
				this.attributes[name] = value;
			},
		};
		element.classList = {
			add: (...classes: string[]) => {
				element.className = [element.className, ...classes].filter(Boolean).join(' ');
			},
		};
		Object.defineProperty(element, 'childElementCount', {
			get: () => element.children.length,
		});
		return element;
	};
	context = {
		createDocumentFragment: vi.fn(() => createElement('#document-fragment')),
		createElement: vi.fn((tagName: string) => createElement(tagName)),
	};
	return context;
}

describe('Notice', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		buttonComponents.instances.length = 0;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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

	test('plugin notices use the active document and ButtonComponent actions', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		const primaryDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		vi.stubGlobal('document', primaryDocument);
		const action = vi.fn();
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn() },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'CANARY_PREFIX'
		);

		const notice = pluginNotices.show(
			'notice-id',
			{},
			{
				timeout: 0,
				button: { text: 'Retry', callback: action },
			}
		);

		expect(popoutDocument.createDocumentFragment).toHaveBeenCalledTimes(1);
		expect(primaryDocument.createDocumentFragment).not.toHaveBeenCalled();
		const fragment = (Notice as any).mock.calls[0][0];
		expect(fragment.ownerDocument).toBe(popoutDocument);
		expect(fragment.children[0].className).toBe('plugin-notice');
		expect(fragment.children[0].children[0].textContent).toBe('[CANARY_PREFIX]');
		expect(fragment.children[0].children[1].textContent).toBe('A fixed notice.');

		const [actionButton, muteButton] = buttonComponents.instances.map(
			(component) => component.buttonEl
		);
		expect(actionButton.ownerDocument).toBe(popoutDocument);
		expect(actionButton.className).toBe('plugin-notice-btn');
		expect(actionButton.textContent).toBe('Retry');
		expect(actionButton.type).toBe('button');
		expect(muteButton.className).toBe('plugin-notice-btn plugin-notice-btn--mute');
		expect(muteButton.icon).toBe('bell-off');
		expect(muteButton.attributes['aria-label']).toBe('Mute notice: notice-id');

		actionButton.click();
		expect(action).toHaveBeenCalledTimes(1);
		expect((notice as any).hide).toHaveBeenCalledTimes(1);
	});

	test('plugin notice mute failures log only a static message', async () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const saveSettings = vi.fn().mockRejectedValue(new Error(canary));
		const settings: Record<string, unknown> = {};
		const popoutDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		const pluginNotices = new PluginNotices({ settings, saveSettings }, {}, 'CANARY_PREFIX');
		pluginNotices.show('notice-id', {}, { timeout: 0 });
		const muteButton = buttonComponents.instances[0].buttonEl;

		muteButton.click();
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.'));

		expect(pluginNotices.isMuted('notice-id')).toBe(true);
		expect(pluginNotices.listMuted()).toEqual(['notice-id']);
		expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.');
		expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
		expect(JSON.stringify(log.mock.calls)).not.toContain('CANARY_PREFIX');
	});
});
