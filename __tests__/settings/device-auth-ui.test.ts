import { App, Platform } from 'obsidian';
import { CODEX_OAUTH, CodexOAuth } from '../../src/ui/auth';
import { ProviderModal } from '../../src/ui/settings/modals/ProviderModal';
import type { PluginNotices } from '../../src/ui/plugin-notices';
import type { OAuthTokens, ProviderConfig } from '../../src/types';

vi.mock('obsidian', () => {
	class TestElement {
		readonly children: TestElement[] = [];
		readonly attributes = new Map<string, string>();
		readonly tagName: string;
		className = '';
		textContent = '';
		innerHTML = '';
		value = '';
		disabled = false;
		rows = 0;
		settingName = '';
		click?: () => unknown;
		change?: (value: string) => unknown;
		parent: TestElement | null;
		classList: { add: (...names: string[]) => void; remove: (...names: string[]) => void };

		constructor(tagName = 'div', parent: TestElement | null = null) {
			this.tagName = tagName;
			this.parent = parent;
			this.classList = {
				add: (...names) => {
					this.className = [...new Set([...this.className.split(' '), ...names])]
						.filter(Boolean)
						.join(' ');
				},
				remove: (...names) => {
					this.className = this.className
						.split(' ')
						.filter((name) => name && !names.includes(name))
						.join(' ');
				},
			};
		}

		createEl(
			tag: string,
			options?: { cls?: string; text?: string; attr?: Record<string, string> }
		): TestElement {
			const child = new TestElement(tag, this);
			this.children.push(child);
			if (options?.cls) child.classList.add(...options.cls.split(/\s+/));
			if (options?.text !== undefined) child.textContent = options.text;
			for (const [name, value] of Object.entries(options?.attr ?? {}))
				child.setAttribute(name, value);
			return child;
		}

		createDiv(options?: {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		}): TestElement {
			return this.createEl('div', options);
		}

		appendChild(child: TestElement): TestElement {
			child.parent = this;
			this.children.push(child);
			return child;
		}

		setAttribute(name: string, value: string): void {
			this.attributes.set(name, value);
		}

		setCssProps(_props: Record<string, string>): void {}

		empty(): void {
			this.children.length = 0;
		}

		remove(): void {
			if (!this.parent) return;
			const index = this.parent.children.indexOf(this);
			if (index >= 0) this.parent.children.splice(index, 1);
			this.parent = null;
		}

		addEventListener = vi.fn();
		removeEventListener = vi.fn();
		focus = vi.fn();

		querySelector(selector: string): TestElement | null {
			if (selector === '.setting-item:last-child .setting-item-description') {
				const items = this.querySelectorAll('.setting-item');
				return items.at(-1)?.querySelector('.setting-item-description') ?? null;
			}
			return this.querySelectorAll(selector)[0] ?? null;
		}

		querySelectorAll(selector: string): TestElement[] {
			const selectors = selector.split(',').map((part) => part.trim());
			const descendants: TestElement[] = [];
			const visit = (element: TestElement): void => {
				for (const child of element.children) {
					descendants.push(child);
					visit(child);
				}
			};
			visit(this);
			return descendants.filter((element) =>
				selectors.some((part) => {
					if (part.startsWith('.')) return element.className.split(' ').includes(part.slice(1));
					if (part.startsWith('[')) return element.attributes.has('tabindex');
					return element.tagName === part;
				})
			);
		}
	}

	class ButtonComponent {
		private readonly element: TestElement;
		private handler?: () => unknown;

		constructor(containerEl: TestElement) {
			this.element = containerEl.createEl('button');
			this.element.click = () => this.handler?.();
		}

		setButtonText(text: string): this {
			this.element.textContent = text;
			return this;
		}
		setIcon(_icon: string): this {
			return this;
		}
		setTooltip(_tooltip: string): this {
			return this;
		}
		setCta(): this {
			return this;
		}
		setDestructive(): this {
			return this;
		}
		setDisabled(disabled: boolean): this {
			this.element.disabled = disabled;
			return this;
		}
		onClick(handler: () => unknown): this {
			this.handler = handler;
			return this;
		}
	}

	class TextComponent {
		readonly inputEl: TestElement;
		private handler?: (value: string) => unknown;

		constructor(containerEl: TestElement, settingName: string) {
			this.inputEl = containerEl.createEl('input');
			this.inputEl.settingName = settingName;
			this.inputEl.change = (value: string) => {
				this.inputEl.value = value;
				return this.handler?.(value);
			};
		}
		setPlaceholder(_value: string): this {
			return this;
		}
		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}
		onChange(handler: (value: string) => unknown): this {
			this.handler = handler;
			return this;
		}
	}

	class DropdownComponent {
		readonly inputEl: TestElement;
		private handler?: (value: string) => unknown;
		constructor(containerEl: TestElement, settingName: string) {
			this.inputEl = containerEl.createEl('select');
			this.inputEl.settingName = settingName;
			this.inputEl.change = (value: string) => {
				this.inputEl.value = value;
				return this.handler?.(value);
			};
		}
		addOption(_value: string, _display: string): this {
			return this;
		}
		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}
		onChange(handler: (value: string) => unknown): this {
			this.handler = handler;
			return this;
		}
	}

	class Setting {
		readonly settingEl: TestElement;
		readonly controlEl: TestElement;
		private name = '';
		constructor(containerEl: TestElement) {
			this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
			this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
		}
		setName(name: string): this {
			this.name = name;
			this.settingEl.settingName = name;
			return this;
		}
		setDesc(text: string): this {
			this.settingEl.createDiv({ cls: 'setting-item-description', text });
			return this;
		}
		setHeading(): this {
			return this;
		}
		addText(callback: (component: TextComponent) => void): this {
			callback(new TextComponent(this.controlEl, this.name));
			return this;
		}
		addDropdown(callback: (component: DropdownComponent) => void): this {
			callback(new DropdownComponent(this.controlEl, this.name));
			return this;
		}
		addToggle(_callback: (component: unknown) => void): this {
			return this;
		}
		addButton(callback: (component: ButtonComponent) => void): this {
			callback(new ButtonComponent(this.controlEl));
			return this;
		}
		addExtraButton(callback: (component: ButtonComponent) => void): this {
			callback(new ButtonComponent(this.controlEl));
			return this;
		}
	}

	class TextAreaComponent {
		readonly inputEl: TestElement;
		constructor(containerEl: TestElement) {
			this.inputEl = containerEl.createEl('textarea');
		}
		setPlaceholder(_value: string): this {
			return this;
		}
		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}
		onChange(_handler: (value: string) => unknown): this {
			return this;
		}
	}

	class Modal {
		readonly contentEl = new TestElement();
		readonly modalEl = { addClass: vi.fn() };
		constructor(_app: unknown) {}
		open(): void {}
		close(): void {
			this.onClose();
		}
		onOpen(): void {}
		onClose(): void {}
	}

	return {
		App: class App {},
		ButtonComponent,
		ExtraButtonComponent: ButtonComponent,
		Modal,
		Platform: { isDesktop: true, isMobile: false, isDesktopApp: true, isMobileApp: false },
		requestUrl: vi.fn(),
		Setting,
		TextAreaComponent,
		TextComponent,
	};
});

vi.mock('../../src/utils/lib-utils', () => {
	const presets = [
		{ name: 'Custom Provider', baseUrl: '', temperature: 0.7 },
		{ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', temperature: 0.7 },
		{
			name: 'Codex',
			baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
			temperature: 0.7,
			authType: 'oauth',
		},
	];
	return {
		getProviderPresets: () => presets,
		getProviderPreset: (name: string) =>
			presets.find((preset) => preset.name === name) ?? presets[0],
	};
});

vi.mock('../../src/ui/settings/components/Notice', () => ({
	Notice: { startProgress: vi.fn(() => null), endProgress: vi.fn() },
}));

interface TestControl {
	settingName: string;
	change(value: string): unknown;
}

interface TestButton {
	textContent: string;
	click(): unknown;
}

interface TestSetting {
	settingName: string;
	querySelector(selector: string): { textContent: string } | null;
}

function getControl(modal: ProviderModal, settingName: string): TestControl {
	const controls = modal.contentEl.querySelectorAll('input, select') as unknown as TestControl[];
	const control = controls.find((candidate) => candidate.settingName === settingName);
	if (!control) throw new Error(`Missing control: ${settingName}`);
	return control;
}

function getButton(modal: ProviderModal, label: string): TestButton {
	const buttons = modal.contentEl.querySelectorAll('button') as unknown as TestButton[];
	const button = buttons.find((candidate) => candidate.textContent === label);
	if (!button) throw new Error(`Missing button: ${label}`);
	return button;
}

function getSettingDescription(modal: ProviderModal, name: string): string | undefined {
	const settings = modal.contentEl.querySelectorAll('.setting-item') as unknown as TestSetting[];
	return settings
		.find((setting) => setting.settingName === name)
		?.querySelector('.setting-item-description')?.textContent;
}

function makeDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const tokens: OAuthTokens = {
	accessToken: 'synthetic-access-token',
	refreshToken: 'synthetic-refresh-token',
	expiresAt: Math.floor(Date.now() / 1000) + 3600,
	accountId: 'synthetic-account',
};

function selectCodex(modal: ProviderModal): void {
	getControl(modal, 'Provider Preset').change('Codex');
}

beforeEach(() => {
	vi.clearAllMocks();
	Platform.isDesktop = true;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Platform.isDesktop = true;
});

describe('ProviderModal device-code authentication UI', () => {
	it('renders a malicious device code as text and opens only the fixed verification URL on explicit action', async () => {
		const onSave = vi.fn();
		const show = vi.fn();
		const modal = new ProviderModal(new App(), onSave, { show } as unknown as PluginNotices);
		modal.onOpen();
		selectCodex(modal);

		const pending = makeDeferred<OAuthTokens>();
		let receiveCode: Parameters<CodexOAuth['startAuthFlow']>[0] | undefined;
		vi.spyOn(CodexOAuth.prototype, 'startAuthFlow').mockImplementation(async (callback) => {
			receiveCode = callback;
			return pending.promise;
		});
		const open = vi.fn();
		vi.stubGlobal('window', { open });

		const connection = getButton(modal, 'Connect Account').click() as Promise<void>;
		expect(receiveCode).toBeDefined();
		const canary = '<img src=x onerror="window.__deviceCodeInjected=true">';
		receiveCode?.({ userCode: canary, verificationUri: 'https://attacker.example/verify' });

		const codeSection = modal.contentEl.querySelector('.oauth-device-code');
		const codeElement = codeSection?.querySelector('code') as unknown as {
			textContent: string;
			innerHTML: string;
			querySelector: (selector: string) => unknown;
		} | null;
		expect(codeElement?.textContent).toBe(canary);
		expect(codeElement?.innerHTML).toBe('');
		expect(codeElement?.querySelector('img')).toBeNull();
		expect(codeSection?.querySelector('p')?.textContent).toContain(
			CODEX_OAUTH.DEVICE_VERIFICATION_URI
		);
		expect(codeSection?.querySelector('p')?.textContent).not.toContain('attacker.example');
		expect(open).not.toHaveBeenCalled();

		getButton(modal, 'Open verification page').click();
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith(CODEX_OAUTH.DEVICE_VERIFICATION_URI, '_blank');
		pending.resolve(tokens);
		await connection;
	});

	it('cancels on close and ignores late success or failure after closing and reopening', async () => {
		const show = vi.fn();
		const onSave = vi.fn();
		const cancelFlow = vi.spyOn(CodexOAuth.prototype, 'cancelFlow');
		let pending = makeDeferred<OAuthTokens>();
		let receiveCode: Parameters<CodexOAuth['startAuthFlow']>[0] | undefined;
		vi.spyOn(CodexOAuth.prototype, 'startAuthFlow').mockImplementation(async (callback) => {
			receiveCode = callback;
			return pending.promise;
		});

		for (const outcome of ['success', 'failure'] as const) {
			const modal = new ProviderModal(new App(), onSave, { show } as unknown as PluginNotices);
			modal.onOpen();
			selectCodex(modal);
			pending = makeDeferred<OAuthTokens>();
			const connection = getButton(modal, 'Connect Account').click() as Promise<void>;

			getButton(modal, 'Cancel').click();
			expect(cancelFlow).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 2);
			modal.onOpen();
			receiveCode?.({ userCode: 'stale-code', verificationUri: 'https://attacker.example/verify' });
			if (outcome === 'success') pending.resolve(tokens);
			else pending.reject(new Error('late synthetic failure'));
			await connection;

			expect(show).not.toHaveBeenCalled();
			expect(onSave).not.toHaveBeenCalled();
			expect(getSettingDescription(modal, 'Authentication')).toBe(
				'Connect your account to use this provider'
			);
			expect(getButton(modal, 'Connect Account')).toBeDefined();
			expect(modal.contentEl.querySelector('.oauth-device-code')).toBeNull();
		}
	});

	it('keeps the Codex connect flow available when the host is not desktop', async () => {
		Platform.isDesktop = false;
		const modal = new ProviderModal(new App(), vi.fn(), {
			show: vi.fn(),
		} as unknown as PluginNotices);
		modal.onOpen();
		selectCodex(modal);
		const startAuthFlow = vi.spyOn(CodexOAuth.prototype, 'startAuthFlow').mockResolvedValue(tokens);

		await getButton(modal, 'Connect Account').click();

		expect(startAuthFlow).toHaveBeenCalledTimes(1);
	});

	it('preserves existing provider fields when edited settings are saved', () => {
		const existingProvider: ProviderConfig = {
			name: 'Existing Provider',
			apiKey: 'existing-api-key',
			baseUrl: 'https://existing.example/v1/chat',
			models: [{ id: 'existing-model', name: 'Existing Model' }],
			temperature: 0.25,
			authType: 'apiKey',
		};
		const onSave = vi.fn();
		const modal = new ProviderModal(
			new App(),
			onSave,
			{ show: vi.fn() } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();

		getControl(modal, 'Provider Name').change('Renamed Provider');
		getControl(modal, 'API URL').change('https://updated.example/v1/chat');
		getButton(modal, 'Save').click();

		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave).toHaveBeenCalledWith({
			...existingProvider,
			name: 'Renamed Provider',
			baseUrl: 'https://updated.example/v1/chat',
		});
		expect(existingProvider.name).toBe('Existing Provider');
		expect(existingProvider.baseUrl).toBe('https://existing.example/v1/chat');
	});
});
