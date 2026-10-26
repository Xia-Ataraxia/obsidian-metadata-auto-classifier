import { Notice as SettingsNotice } from '../../../src/ui/settings/components/Notice';
import { Notice } from 'obsidian';
import { PluginNotices } from '../../../src/ui/plugin-notices';

const obsidianMocks = vi.hoisted(() => ({
	Notice: vi.fn(),
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
}));

vi.mock('obsidian', () => obsidianMocks);

(global as any).window = global;

function createObsidianDocumentBoundary(): any {
	let context: any;
	const createElement = (tagName: string) => {
		const listeners = new Map<string, (event: { stopPropagation: () => void }) => void>();
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
			createEl(childTagName: string, options: Record<string, unknown> = {}) {
				const child = context.createElement(childTagName);
				child.className = (options['cls'] as string | undefined) ?? '';
				child.textContent = (options['text'] as string | undefined) ?? '';
				child.type = options['type'];
				return this.appendChild(child);
			},
			createDiv(options: Record<string, unknown> = {}) {
				return this.createEl('div', options);
			},
			createSpan(options: Record<string, unknown> = {}) {
				return this.createEl('span', options);
			},
			setAttribute(name: string, value: string) {
				this.attributes[name] = value;
			},
			setText(text: string) {
				this.textContent = text;
			},
			addClass(className: string) {
				this.className = [this.className, className].filter(Boolean).join(' ');
			},
			addEventListener(
				name: string,
				callback: (event: { stopPropagation: () => void }) => void
			) {
				listeners.set(name, callback);
			},
			click() {
				const stopPropagation = vi.fn();
				listeners.get('click')?.({ stopPropagation });
				return stopPropagation;
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

function installObsidianDocumentHelpers(): void {
	vi.stubGlobal('createFragment', () => (global as any).activeDocument.createDocumentFragment());
	vi.stubGlobal('createDiv', (options: Record<string, unknown> = {}) => {
		const div = (global as any).activeDocument.createElement('div');
		div.className = (options['cls'] as string | undefined) ?? '';
		div.textContent = (options['text'] as string | undefined) ?? '';
		return div;
	});
	vi.stubGlobal('createEl', (tagName: string, options: Record<string, unknown> = {}) => {
		const element = (global as any).activeDocument.createElement(tagName);
		element.className = (options['cls'] as string | undefined) ?? '';
		element.textContent = (options['text'] as string | undefined) ?? '';
		element.type = options['type'];
		return element;
	});
}

describe('Notice', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		obsidianMocks.Notice.mockImplementation(function (this: any, message: unknown, duration: number) {
			this.message = message;
			this.duration = duration;
			this.setMessage = vi.fn();
			this.hide = vi.fn();
		});
		obsidianMocks.setIcon.mockImplementation((element: any, icon: string) => {
			element.icon = icon;
		});
		obsidianMocks.setTooltip.mockImplementation((element: any, tooltip: string) => {
			element.tooltip = tooltip;
		});
		SettingsNotice.head = 'Metadata Auto Classifier';
		vi.stubGlobal('activeDocument', createObsidianDocumentBoundary());
		installObsidianDocumentHelpers();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
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

	test('progress uses the plugin header and themed spinner, updates waiting copy, and expires safely', () => {
		vi.useFakeTimers();
		const popoutDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);

		const progressNotice = SettingsNotice.startProgress('Task');
		const fragment = Notice.mock.calls[0][0];
		const root = fragment.children[0];
		const content = root.children[1].children[0];

		expect(Notice).toHaveBeenCalledWith(fragment, 0);
		expect(root.className).toContain('metadata-auto-classifier-notice--progress');
		expect(root.children[0].textContent).toBe('Metadata Auto Classifier');
		expect(content.children[0].className).toBe('metadata-auto-classifier-notice-spinner');
		expect(content.children[1].textContent).toBe('Task');
		expect((progressNotice as any).waitingTimer).toBeDefined();
		expect((progressNotice as any).capTimer).toBeDefined();

		vi.advanceTimersByTime(15000);
		expect(content.children[1].textContent).toBe('Task, still waiting…');
		vi.advanceTimersByTime(105000);
		expect((progressNotice as any).hide).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('withProgress preserves the result and cleans up its timers', async () => {
		vi.useFakeTimers();
		const fn = vi.fn().mockResolvedValue('done');

		await expect(SettingsNotice.withProgress('file.md', 'tags', fn)).resolves.toBe('done');

		const progressNotice = Notice.mock.results[0].value;
		expect(fn).toHaveBeenCalledTimes(1);
		expect(progressNotice.hide).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('withProgress cleans up after rejection without changing its rejection', async () => {
		vi.useFakeTimers();
		const error = new Error('key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH');

		await expect(
			SettingsNotice.withProgress('file.md', 'tags', () => Promise.reject(error))
		).rejects.toBe(error);

		const progressNotice = Notice.mock.results[0].value;
		expect(progressNotice.hide).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('plugin notices render the manifest name and an accessible inline mute action', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		const primaryDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		vi.stubGlobal('document', primaryDocument);
		const action = vi.fn();
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn() },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'Metadata Auto Classifier'
		);

		const notice = pluginNotices.show(
			'notice-id',
			{},
			{ timeout: 0, button: { text: 'Retry', callback: action } }
		);

		expect(popoutDocument.createDocumentFragment).toHaveBeenCalledTimes(1);
		expect(primaryDocument.createDocumentFragment).not.toHaveBeenCalled();
		const fragment = Notice.mock.calls[0][0];
		const root = fragment.children[0];
		const row = root.children[1];
		const muteButton = row.children[1];
		const actionButton = root.children[2].children[0];

		expect(fragment.ownerDocument).toBe(popoutDocument);
		expect(root.className).toBe('metadata-auto-classifier-notice');
		expect(root.children[0].textContent).toBe('Metadata Auto Classifier');
		expect(row.children[0].textContent).toBe('A fixed notice.');
		expect(muteButton.tagName).toBe('button');
		expect(muteButton.className).toBe('metadata-auto-classifier-notice-mute');
		expect(muteButton.type).toBe('button');
		expect(muteButton.icon).toBe('bell-off');
		expect(muteButton.tooltip).toBe('Mute this notice');
		expect(muteButton.attributes['aria-label']).toBe('Mute notice: notice-id');
		expect(actionButton.className).toBe('metadata-auto-classifier-notice-action');
		expect(actionButton.textContent).toBe('Retry');
		expect(actionButton.type).toBe('button');
		expect(obsidianMocks.setIcon).toHaveBeenCalledWith(muteButton, 'bell-off');
		expect(obsidianMocks.setTooltip).toHaveBeenCalledWith(muteButton, 'Mute this notice');

		const stopPropagation = actionButton.click();
		expect(action).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect((notice as any).hide).toHaveBeenCalledTimes(1);
	});

	test('plugin action cleanup runs even when its callback throws', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn() },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'Metadata Auto Classifier'
		);
		const callback = vi.fn(() => {
			throw new Error('callback failed');
		});
		const notice = pluginNotices.show('notice-id', {}, {
			timeout: 0,
			button: { text: 'Retry', callback },
		});
		const actionButton = Notice.mock.calls[0][0].children[0].children[2].children[0];

		expect(() => actionButton.click()).toThrow('callback failed');
		expect((notice as any).hide).toHaveBeenCalledTimes(1);
	});

	test('plugin notice mute failures log only a static message', async () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const saveSettings = vi.fn().mockRejectedValue(new Error(canary));
		const settings: Record<string, unknown> = {};
		const popoutDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		const pluginNotices = new PluginNotices(
			{ settings, saveSettings },
			{},
			'Metadata Auto Classifier'
		);
		const notice = pluginNotices.show('notice-id', {}, { timeout: 0 });
		const muteButton = Notice.mock.calls[0][0].children[0].children[1].children[1];

		muteButton.click();
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.'));

		expect(pluginNotices.isMuted('notice-id')).toBe(true);
		expect(pluginNotices.listMuted()).toEqual(['notice-id']);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect((notice as any).hide).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.');
		expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
		expect(JSON.stringify(log.mock.calls)).not.toContain('Metadata Auto Classifier');
	});

	test('notice-muted action opens settings and immutable notice has no mute control', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		const openSettings = vi.fn();
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn(), openSettings },
			{},
			'Metadata Auto Classifier'
		);

		const notice = pluginNotices.show('notice_muted');
		const fragment = Notice.mock.calls[0][0];
		const root = fragment.children[0];
		const row = root.children[1];
		const actionButton = root.children[2].children[0];

		expect(row.children).toHaveLength(1);
		expect(root.children[0].textContent).toBe('Metadata Auto Classifier');
		expect(row.children[0].textContent).toBe('Notice muted. Reset it in settings.');
		expect(actionButton.textContent).toBe('Open settings');
		actionButton.click();
		expect(openSettings).toHaveBeenCalledTimes(1);
		expect((notice as any).hide).toHaveBeenCalledTimes(1);
	});

	test('repeated plugin notices are freshly re-announced', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		vi.stubGlobal('activeDocument', popoutDocument);
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn() },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'Metadata Auto Classifier'
		);

		const first = pluginNotices.show('notice-id');
		const second = pluginNotices.show('notice-id');

		expect(second).not.toBe(first);
		expect((first as any).hide).toHaveBeenCalledTimes(1);
		expect(Notice).toHaveBeenCalledTimes(2);
	});
});
