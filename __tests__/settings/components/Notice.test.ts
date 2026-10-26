import { Notice as SettingsNotice } from '../../../src/ui/settings/components/Notice';
import { Notice } from 'obsidian';
import { PluginNotices } from '../../../src/ui/plugin-notices';

interface SyntheticNoticeNode {
	children: SyntheticNoticeNode[];
	className: string;
	textContent: string;
	tagName: string;
	type?: string;
	icon?: string;
	tooltip?: string;
	attributes: Record<string, string>;
	ownerDocument: unknown;
	click(): ReturnType<typeof vi.fn>;
}

interface SyntheticDocumentBoundary {
	createDocumentFragment: () => SyntheticNoticeNode;
	createElement: (tagName: string) => SyntheticNoticeNode;
}

let activeDocumentBoundary: SyntheticDocumentBoundary;

const obsidianMocks = vi.hoisted(() => {
	class Component {
		static instances: Component[] = [];
		loaded = false;
		unloaded = false;
		cleanupRuns = 0;
		private cleanups: Array<() => void> = [];
		load = vi.fn(() => {
			this.loaded = true;
		});
		register = vi.fn((cleanup: () => void) => {
			this.cleanups.push(cleanup);
		});
		unload = vi.fn(() => {
			if (this.unloaded) return;
			this.unloaded = true;
			for (const cleanup of this.cleanups.splice(0)) {
				this.cleanupRuns++;
				cleanup();
			}
		});

		constructor() {
			Component.instances.push(this);
		}
	}

	class ButtonComponent {
		static instances: ButtonComponent[] = [];
		readonly buttonEl: any;
		setButtonText = vi.fn((text: string) => {
			this.buttonEl.textContent = text;
			return this;
		});
		setIcon = vi.fn((icon: string) => {
			this.buttonEl.icon = icon;
			return this;
		});
		setTooltip = vi.fn((tooltip: string) => {
			this.buttonEl.tooltip = tooltip;
			return this;
		});
		onClick = vi.fn((callback: (event: any) => unknown) => {
			this.buttonEl.addEventListener('click', callback);
			return this;
		});

		constructor(containerEl: any) {
			this.buttonEl = containerEl.createEl('button');
			ButtonComponent.instances.push(this);
		}
	}

	return { Notice: vi.fn(), Component, ButtonComponent };
});

vi.mock('obsidian', () => obsidianMocks);

const mockNotice = vi.mocked(Notice);

function noticeCallAt(index: number) {
	const call = mockNotice.mock.calls[index];
	if (!call) throw new Error(`Expected Obsidian notice call at index ${index}`);
	return call;
}

function noticeInstanceAt(index: number) {
	const result = mockNotice.mock.results[index];
	if (!result || result.type !== 'return')
		throw new Error(`Expected Obsidian notice instance at index ${index}`);
	return result.value;
}

function noticeFragmentAt(index: number): SyntheticNoticeNode {
	const message: unknown = noticeCallAt(index)[0];
	if (!isSyntheticNoticeNode(message))
		throw new Error(`Expected a rendered notice fragment at call ${index}`);
	return message;
}

function isSyntheticNoticeNode(value: unknown): value is SyntheticNoticeNode {
	if (typeof value !== 'object' || value === null) return false;
	if (
		!('children' in value) ||
		!('className' in value) ||
		!('textContent' in value) ||
		!('tagName' in value) ||
		!('attributes' in value) ||
		!('ownerDocument' in value) ||
		!('click' in value)
	)
		return false;
	const children = value.children;
	const attributes = value.attributes;
	return (
		Array.isArray(children) &&
		children.every(isSyntheticNoticeNode) &&
		typeof value.className === 'string' &&
		typeof value.textContent === 'string' &&
		typeof value.tagName === 'string' &&
		typeof attributes === 'object' &&
		attributes !== null &&
		!Array.isArray(attributes) &&
		Object.values(attributes).every((attribute) => typeof attribute === 'string') &&
		typeof value.click === 'function'
	);
}

function noticeChildAt(node: SyntheticNoticeNode, index: number): SyntheticNoticeNode {
	const child = node.children[index];
	if (!child) throw new Error(`Expected notice child at index ${index}`);
	return child;
}

function buttonComponentFor(element: SyntheticNoticeNode) {
	const button = obsidianMocks.ButtonComponent.instances.find(
		(component) => component.buttonEl === element
	);
	if (!button) throw new Error('Expected the notice control to use ButtonComponent');
	return button;
}

function componentAt(index: number) {
	const component = obsidianMocks.Component.instances[index];
	if (!component) throw new Error(`Expected Obsidian component at index ${index}`);
	return component;
}

function createObsidianDocumentBoundary(): SyntheticDocumentBoundary {
	let context: any;
	const createNode = (tagName: string, options: Record<string, unknown> = {}) => {
		const listeners = new Map<string, (event: { stopPropagation: () => void }) => void>();
		const element: any = {
			tagName,
			ownerDocument: context,
			children: [],
			className: (options['cls'] as string | undefined) ?? '',
			textContent: (options['text'] as string | undefined) ?? '',
			attributes: {} as Record<string, string>,
			appendChild(child: any) {
				this.children.push(child);
				return child;
			},
			createEl(childTagName: string, options: Record<string, unknown> = {}) {
				const child = createNode(childTagName, options);
				child.type = options['type'];
				return this.appendChild(child);
			},
			createDiv(options: Record<string, unknown> = {}) {
				const child = createNode('div', options);
				child.type = options['type'];
				return this.appendChild(child);
			},
			createSpan(options: Record<string, unknown> = {}) {
				const child = createNode('span', options);
				child.type = options['type'];
				return this.appendChild(child);
			},
			setAttribute(name: string, value: string) {
				this.attributes[name] = value;
				if (name === 'type') this.type = value;
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
		createDocumentFragment: vi.fn(() => createNode('#document-fragment')),
		createElement: vi.fn((tagName: string) => createNode(tagName)),
	};
	return context;
}

function activateDocumentBoundary(boundary: SyntheticDocumentBoundary): void {
	activeDocumentBoundary = boundary;
	vi.stubGlobal('activeDocument', boundary);
}

function installObsidianDocumentHelpers(): void {
	vi.stubGlobal('createFragment', () => activeDocumentBoundary.createDocumentFragment());
	vi.stubGlobal('createDiv', (options: Record<string, unknown> = {}) => {
		const div = activeDocumentBoundary.createElement('div');
		div.className = (options['cls'] as string | undefined) ?? '';
		div.textContent = (options['text'] as string | undefined) ?? '';
		return div;
	});
	vi.stubGlobal('createEl', (tagName: string, options: Record<string, unknown> = {}) => {
		const element = activeDocumentBoundary.createElement(tagName);
		element.className = (options['cls'] as string | undefined) ?? '';
		element.textContent = (options['text'] as string | undefined) ?? '';
		element.type = typeof options['type'] === 'string' ? options['type'] : undefined;
		return element;
	});
}

describe('Notice', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		obsidianMocks.Component.instances.length = 0;
		obsidianMocks.ButtonComponent.instances.length = 0;
		vi.mocked(obsidianMocks.Notice).mockImplementation(function (
			this: any,
			message: unknown,
			duration: number
		) {
			this.message = message;
			this.duration = duration;
			this.setMessage = vi.fn();
			this.hide = vi.fn();
		});
		SettingsNotice.head = 'Metadata Auto Classifier';
		activateDocumentBoundary(createObsidianDocumentBoundary());
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

		expect(mockNotice).toHaveBeenCalledWith('❌ An error occurred.', 5000);
		expect(mockNotice).toHaveBeenCalledTimes(3);
		expect(log).toHaveBeenCalledWith('[MAC] An error occurred.');
		expect(log).toHaveBeenCalledTimes(3);
		expect(JSON.stringify([mockNotice.mock.calls, log.mock.calls])).not.toContain(canary);
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
		expect(mockNotice).toHaveBeenCalledWith('❌ An error occurred.', 5000);
		expect(log).toHaveBeenCalledWith('[MAC] An error occurred.');
	});

	test('validation errors retain a safe static category', () => {
		const canary = 'private validation text';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});

		SettingsNotice.validationError(canary, canary);

		expect(SettingsNotice.formatValidationError(canary, canary)).toBe(
			'[Validation] Validation failed.'
		);
		expect(mockNotice).toHaveBeenCalledWith('❌ [Validation] Validation failed.', 5000);
		expect(log).toHaveBeenCalledWith('[MAC] [Validation] Validation failed.');
		expect(JSON.stringify([mockNotice.mock.calls, log.mock.calls])).not.toContain(canary);
	});

	test('success shows success notice', () => {
		SettingsNotice.success('ok');
		expect(mockNotice).toHaveBeenCalledWith('ok', 3000);
	});

	test('progress uses the plugin header, updates waiting copy, and unloads cleanly on end', () => {
		vi.useFakeTimers();
		const popoutDocument = createObsidianDocumentBoundary();
		activateDocumentBoundary(popoutDocument);

		const progress = SettingsNotice.startProgress('Task');
		const scope = componentAt(0);
		const fragment = noticeFragmentAt(0);
		const root = noticeChildAt(fragment, 0);
		const row = noticeChildAt(root, 1);
		const content = noticeChildAt(row, 0);

		expect(mockNotice).toHaveBeenCalledWith(fragment, 0);
		expect(root.className).toContain('metadata-auto-classifier-notice--progress');
		expect(noticeChildAt(root, 0).textContent).toBe('Metadata Auto Classifier');
		expect(noticeChildAt(content, 0).className).toBe('metadata-auto-classifier-notice-spinner');
		expect(noticeChildAt(content, 1).textContent).toBe('Task');
		expect(progress.notice).toBe(noticeInstanceAt(0));
		expect(scope.loaded).toBe(true);
		expect(scope.load).toHaveBeenCalledOnce();
		expect(scope.register).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(2);

		vi.advanceTimersByTime(15000);
		expect(noticeChildAt(content, 1).textContent).toBe('Task, still waiting…');
		expect(vi.getTimerCount()).toBe(1);
		SettingsNotice.endProgress(progress);
		expect(scope.unload).toHaveBeenCalledTimes(1);
		expect(scope.cleanupRuns).toBe(1);
		expect(progress.notice.hide).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);

		SettingsNotice.endProgress(progress);
		expect(scope.unload).toHaveBeenCalledTimes(2);
		expect(scope.cleanupRuns).toBe(1);
		expect(progress.notice.hide).toHaveBeenCalledTimes(1);
	});

	test('progress safety cap unloads its scope and clears both timers', () => {
		vi.useFakeTimers();
		SettingsNotice.startProgress('Task');
		const scope = componentAt(0);
		const notice = noticeInstanceAt(0);

		vi.advanceTimersByTime(120000);

		expect(scope.unload).toHaveBeenCalledOnce();
		expect(scope.cleanupRuns).toBe(1);
		expect(notice.hide).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	test('withProgress preserves the result and cleans up its timers', async () => {
		vi.useFakeTimers();
		const fn = vi.fn().mockResolvedValue('done');

		await expect(SettingsNotice.withProgress('file.md', 'tags', fn)).resolves.toBe('done');

		const progressNotice = noticeInstanceAt(0);
		const scope = componentAt(0);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(progressNotice.hide).toHaveBeenCalledTimes(1);
		expect(scope.unload).toHaveBeenCalledOnce();
		expect(scope.cleanupRuns).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('withProgress cleans up after rejection without changing its rejection', async () => {
		vi.useFakeTimers();
		const error = new Error('key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH');

		await expect(
			SettingsNotice.withProgress('file.md', 'tags', () => Promise.reject(error))
		).rejects.toBe(error);

		const progressNotice = noticeInstanceAt(0);
		const scope = componentAt(0);
		expect(progressNotice.hide).toHaveBeenCalledTimes(1);
		expect(scope.unload).toHaveBeenCalledOnce();
		expect(scope.cleanupRuns).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('plugin notices render the manifest name and an accessible inline mute action', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		const primaryDocument = createObsidianDocumentBoundary();
		activateDocumentBoundary(popoutDocument);
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
		if (!notice) throw new Error('Expected the plugin notice to be shown');

		expect(popoutDocument.createDocumentFragment).toHaveBeenCalledTimes(1);
		expect(primaryDocument.createDocumentFragment).not.toHaveBeenCalled();
		const fragment = noticeFragmentAt(0);
		const root = noticeChildAt(fragment, 0);
		const row = noticeChildAt(root, 1);
		const muteButton = noticeChildAt(row, 1);
		const actionButton = noticeChildAt(noticeChildAt(root, 2), 0);

		expect(fragment.ownerDocument).toBe(popoutDocument);
		expect(root.className).toBe('metadata-auto-classifier-notice');
		expect(noticeChildAt(root, 0).textContent).toBe('Metadata Auto Classifier');
		expect(noticeChildAt(row, 0).textContent).toBe('A fixed notice.');
		expect(muteButton.tagName).toBe('button');
		expect(muteButton.className).toBe('metadata-auto-classifier-notice-mute');
		expect(muteButton.type).toBe('button');
		expect(muteButton.icon).toBe('bell-off');
		expect(muteButton.tooltip).toBe('Mute this notice');
		expect(muteButton.attributes['aria-label']).toBe('Mute notice: notice-id');
		expect(actionButton.className).toBe('metadata-auto-classifier-notice-action');
		expect(actionButton.textContent).toBe('Retry');
		expect(actionButton.type).toBe('button');
		const muteButtonComponent = buttonComponentFor(muteButton);
		expect(muteButtonComponent.setIcon).toHaveBeenCalledWith('bell-off');
		expect(muteButtonComponent.setTooltip).toHaveBeenCalledWith('Mute this notice');
		expect(muteButtonComponent.onClick).toHaveBeenCalledTimes(1);
		expect(buttonComponentFor(actionButton).onClick).toHaveBeenCalledTimes(1);

		const stopPropagation = actionButton.click();
		expect(action).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(notice.hide).toHaveBeenCalledTimes(1);
	});

	test('plugin action cleanup runs even when its callback throws', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		activateDocumentBoundary(popoutDocument);
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
		if (!notice) throw new Error('Expected the plugin notice to be shown');
		const actionButton = noticeChildAt(
			noticeChildAt(noticeChildAt(noticeFragmentAt(0), 0), 2),
			0
		);

		expect(() => actionButton.click()).toThrow('callback failed');
		expect(callback).toHaveBeenCalledOnce();
		expect(notice.hide).toHaveBeenCalledTimes(1);
	});

	test('plugin notice mute failures log only a static message', async () => {
		const canary = 'key=CANARY_KEY body=CANARY_BODY /private/CANARY_PATH';
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const saveSettings = vi.fn().mockRejectedValue(new Error(canary));
		const settings: Record<string, unknown> = {};
		const popoutDocument = createObsidianDocumentBoundary();
		activateDocumentBoundary(popoutDocument);
		const pluginNotices = new PluginNotices(
			{ settings, saveSettings },
			{},
			'Metadata Auto Classifier'
		);
		const notice = pluginNotices.show('notice-id', {}, { timeout: 0 });
		if (!notice) throw new Error('Expected the plugin notice to be shown');
		const muteButton = noticeChildAt(
			noticeChildAt(noticeChildAt(noticeFragmentAt(0), 0), 1),
			1
		);

		const stopPropagation = muteButton.click();
		expect(stopPropagation).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.'));

		expect(pluginNotices.isMuted('notice-id')).toBe(true);
		expect(pluginNotices.listMuted()).toEqual(['notice-id']);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(notice.hide).not.toHaveBeenCalled();
		expect(mockNotice).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith('[MAC] Failed to mute notice.');
		expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
		expect(JSON.stringify(log.mock.calls)).not.toContain('Metadata Auto Classifier');
	});

	test('notice-muted action opens settings and immutable notice has no mute control', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		activateDocumentBoundary(popoutDocument);
		const openSettings = vi.fn();
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn(), openSettings },
			{},
			'Metadata Auto Classifier'
		);

		const notice = pluginNotices.show('notice_muted');
		if (!notice) throw new Error('Expected the immutable notice to be shown');
		const fragment = noticeFragmentAt(0);
		const root = noticeChildAt(fragment, 0);
		const row = noticeChildAt(root, 1);
		const actionButton = noticeChildAt(noticeChildAt(root, 2), 0);

		expect(row.children).toHaveLength(1);
		expect(noticeChildAt(root, 0).textContent).toBe('Metadata Auto Classifier');
		expect(noticeChildAt(row, 0).textContent).toBe('Notice muted. Undo, or reset it in settings.');
		expect(actionButton.textContent).toBe('Open settings');
		expect(buttonComponentFor(actionButton).onClick).toHaveBeenCalledOnce();
		actionButton.click();
		expect(openSettings).toHaveBeenCalledTimes(1);
		expect(notice.hide).toHaveBeenCalledTimes(1);
	});

	test('muting a notice offers Undo that unmutes the key and saves', async () => {
		activateDocumentBoundary(createObsidianDocumentBoundary());
		const settings: Record<string, unknown> = {};
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const openSettings = vi.fn();
		const pluginNotices = new PluginNotices(
			{ settings, saveSettings, openSettings },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'Metadata Auto Classifier'
		);
		pluginNotices.show('notice-id', {}, { timeout: 0 });
		const row = noticeChildAt(noticeChildAt(noticeFragmentAt(0), 0), 1);
		noticeChildAt(row, 1).click();
		await vi.waitFor(() => expect(mockNotice).toHaveBeenCalledTimes(2));
		expect(pluginNotices.isMuted('notice-id')).toBe(true);

		const actions = noticeChildAt(noticeChildAt(noticeFragmentAt(1), 0), 2);
		expect(actions.children.map((b) => b.textContent)).toEqual(['Undo', 'Open settings']);
		actions.children[0]?.click();
		await vi.waitFor(() => expect(pluginNotices.isMuted('notice-id')).toBe(false));
		expect(pluginNotices.listMuted()).toEqual([]);
		expect(saveSettings).toHaveBeenCalledTimes(2);
		expect(openSettings).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(mockNotice).toHaveBeenCalledTimes(3));
		expect(noticeChildAt(noticeChildAt(noticeChildAt(noticeFragmentAt(2), 0), 1), 0).textContent).toBe('Notice unmuted.');
	});

	test('a failed Undo shows a visible failure notice', async () => {
		activateDocumentBoundary(createObsidianDocumentBoundary());
		const saveSettings = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('disk'));
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'Metadata Auto Classifier'
		);
		pluginNotices.show('notice-id', {}, { timeout: 0 });
		noticeChildAt(noticeChildAt(noticeChildAt(noticeFragmentAt(0), 0), 1), 1).click();
		await vi.waitFor(() => expect(mockNotice).toHaveBeenCalledTimes(2));
		noticeChildAt(noticeChildAt(noticeChildAt(noticeFragmentAt(1), 0), 2), 0).click();
		await vi.waitFor(() => expect(mockNotice).toHaveBeenCalledTimes(3));
		expect(noticeChildAt(noticeChildAt(noticeChildAt(noticeFragmentAt(2), 0), 1), 0).textContent).toBe(
			'Notice could not be unmuted. Try again in settings.'
		);
		expect(pluginNotices.isMuted('notice-id')).toBe(true);
		expect(pluginNotices.listMuted()).toEqual(['notice-id']);
	});

	test('repeated plugin notices are freshly re-announced', () => {
		const popoutDocument = createObsidianDocumentBoundary();
		activateDocumentBoundary(popoutDocument);
		const pluginNotices = new PluginNotices(
			{ settings: {}, saveSettings: vi.fn() },
			{ 'notice-id': { template: 'A fixed notice.' } },
			'Metadata Auto Classifier'
		);

		const first = pluginNotices.show('notice-id');
		const second = pluginNotices.show('notice-id');
		if (!first || !second) throw new Error('Expected repeated plugin notices to be shown');

		expect(second).not.toBe(first);
		expect(first.hide).toHaveBeenCalledTimes(1);
		expect(mockNotice).toHaveBeenCalledTimes(2);
	});
});
