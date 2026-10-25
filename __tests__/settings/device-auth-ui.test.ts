import { App, Platform } from 'obsidian';
import { CODEX_OAUTH, CodexOAuth } from '../../src/ui/auth';
import { ProviderModal } from '../../src/ui/settings/modals/ProviderModal';
import { Notice } from '../../src/ui/settings/components/Notice';
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
	Notice: { startProgress: vi.fn(() => ({})), endProgress: vi.fn() },
}));

interface TestControl {
	settingName: string;
	value: string;
	change(value: string): unknown;
}

interface TestButton {
	textContent: string;
	disabled: boolean;
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
		expect((modal as any).providerConfig).toMatchObject({
			authType: 'oauth',
			oauth: tokens,
		});
		expect((modal as any).providerConfig.auth).toBeUndefined();
		expect((modal as any).providerConfig.apiKey).toBeUndefined();
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

	it('keeps provider names read-only and changes them only through supported preset selection', () => {
		const modal = new ProviderModal(new App(), vi.fn(), {
			show: vi.fn(),
		} as unknown as PluginNotices);
		modal.onOpen();

		expect(getSettingDescription(modal, 'Provider Name')).toBe('Custom Provider');
		expect(() => getControl(modal, 'Provider Name')).toThrow('Missing control: Provider Name');
		getControl(modal, 'Provider Preset').change('OpenAI');
		expect(getSettingDescription(modal, 'Provider Name')).toBe('OpenAI');
		expect((modal as any).providerConfig.name).toBe('OpenAI');
	});

	it('does not silently rewrite an unsupported existing provider name and rejects its save', async () => {
		const onSave = vi.fn();
		const show = vi.fn();
		const modal = new ProviderModal(new App(), onSave, { show } as unknown as PluginNotices);
		(modal as any).providerConfig.name = 'Unsupported Backend';
		(modal as any).providerConfig.baseUrl = 'https://unsupported.example/v1/chat';
		modal.onOpen();

		expect(getSettingDescription(modal, 'Provider Name')).toBe('Unsupported Backend');
		expect(() => getButton(modal, 'Connect Account')).toThrow('Missing button: Connect Account');
		await getButton(modal, 'Save').click();

		expect(onSave).not.toHaveBeenCalled();
		expect((modal as any).providerConfig.name).toBe('Unsupported Backend');
		expect(show).toHaveBeenCalledWith('validation_error', {
			component: 'Provider',
			message: 'Select a supported provider preset before saving.',
		});
	});

	it('shows the required API-key control for OpenAI without reading structured OAuth fallbacks', async () => {
		const existingProvider: ProviderConfig = {
			name: 'OpenAI',
			apiKey: 'stale-legacy-key',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			models: [],
			temperature: 0.5,
			authType: 'apiKey',
			oauth: { ...tokens, accessToken: 'stale-legacy-oauth' },
			auth: { type: 'oauth', oauth: tokens },
		};
		const show = vi.fn();
		const onSave = vi.fn();
		const modal = new ProviderModal(
			new App(),
			onSave,
			{ show } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();

		const apiKey = getControl(modal, 'API Key');
		expect(apiKey.value).toBe('');
		expect(() => getButton(modal, 'Connect Account')).toThrow('Missing button: Connect Account');
		expect((modal as any).oauthTokens).toBeUndefined();
		expect((modal as any).providerConfig.auth).toEqual({ type: 'oauth', oauth: tokens });
		expect(existingProvider.auth).toEqual({ type: 'oauth', oauth: tokens });

		await getButton(modal, 'Save').click();
		expect(onSave).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('validation_error', {
			component: 'Provider',
			message: 'Enter an API key for this provider or select a compatible preset.',
		});

		apiKey.change('new-openai-key');
		expect((modal as any).providerConfig.auth).toEqual({
			type: 'apiKey',
			apiKey: 'new-openai-key',
		});
		expect((modal as any).providerConfig.oauth).toBeUndefined();
		await getButton(modal, 'Save').click();
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: { type: 'apiKey', apiKey: 'new-openai-key' },
				apiKey: undefined,
				oauth: undefined,
			})
		);
	});

	it('shows Codex OAuth without reading an explicit API key and requires connecting before save', async () => {
		const existingProvider: ProviderConfig = {
			name: 'Codex',
			apiKey: 'stale-legacy-key',
			baseUrl: CODEX_OAUTH.API_ENDPOINT,
			models: [],
			temperature: 0.5,
			authType: 'oauth',
			oauth: { ...tokens, accessToken: 'stale-legacy-oauth' },
			auth: { type: 'apiKey', apiKey: 'stale-structured-key' },
		};
		const show = vi.fn();
		const onSave = vi.fn();
		const modal = new ProviderModal(
			new App(),
			onSave,
			{ show } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();

		expect(getButton(modal, 'Connect Account')).toBeDefined();
		expect(
			modal.contentEl.querySelectorAll('input').map((input) => input.settingName)
		).not.toContain('API Key');
		expect((modal as any).providerConfig.auth).toEqual({
			type: 'apiKey',
			apiKey: 'stale-structured-key',
		});
		expect((modal as any).oauthTokens).toBeUndefined();
		expect(existingProvider.auth).toEqual({
			type: 'apiKey',
			apiKey: 'stale-structured-key',
		});

		await getButton(modal, 'Save').click();
		expect(onSave).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledWith('validation_error', {
			component: 'Provider',
			message: 'Connect this provider with OAuth or select a compatible preset.',
		});

		vi.spyOn(CodexOAuth.prototype, 'startAuthFlow').mockResolvedValue(tokens);
		await getButton(modal, 'Connect Account').click();
		expect((modal as any).providerConfig.auth).toEqual({ type: 'oauth', oauth: tokens });
		expect((modal as any).providerConfig.apiKey).toBeUndefined();
		expect((modal as any).providerConfig.oauth).toBeUndefined();
		await getButton(modal, 'Save').click();
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: { type: 'oauth', oauth: tokens },
				apiKey: undefined,
				oauth: undefined,
			})
		);
	});

	it('treats malformed explicit auth as authoritative until the required API key repairs it', async () => {
		const malformedAuths: unknown[] = [
			null,
			{},
			{ type: 'password', password: 'secret' },
			{ type: 'apiKey', apiKey: 42 },
		];
		for (const auth of malformedAuths) {
			const existingProvider = {
				name: 'OpenAI',
				apiKey: 'stale-legacy-key',
				baseUrl: 'https://api.openai.com/v1/chat/completions',
				models: [],
				authType: 'apiKey',
				oauth: { ...tokens, accessToken: 'stale-legacy-oauth' },
				auth,
			} as unknown as ProviderConfig;
			const onSave = vi.fn();
			const show = vi.fn();
			const modal = new ProviderModal(
				new App(),
				onSave,
				{ show } as unknown as PluginNotices,
				existingProvider
			);
			modal.onOpen();

			expect(getControl(modal, 'API Key').value).toBe('');
			expect(() => getButton(modal, 'Connect Account')).toThrow('Missing button: Connect Account');
			expect((modal as any).providerConfig.auth).toEqual(auth);
			await getButton(modal, 'Save').click();
			expect(onSave).not.toHaveBeenCalled();
			expect(show).toHaveBeenCalledWith('validation_error', {
				component: 'Provider',
				message: 'Enter an API key for this provider or select a compatible preset.',
			});

			getControl(modal, 'API Key').change('repaired-key');
			expect((modal as any).providerConfig.auth).toEqual({
				type: 'apiKey',
				apiKey: 'repaired-key',
			});
			await getButton(modal, 'Save').click();
			expect(onSave).toHaveBeenCalledOnce();
			expect(existingProvider.auth).toEqual(auth);
		}
	});

	it('retains newer draft edits after a deferred save failure and retries the edited snapshot', async () => {
		const pending = makeDeferred<void>();
		const onSave = vi
			.fn()
			.mockImplementationOnce(() => pending.promise)
			.mockResolvedValue(undefined);
		const show = vi.fn();
		const modal = new ProviderModal(new App(), onSave, { show } as unknown as PluginNotices);
		modal.onOpen();
		getControl(modal, 'Provider Preset').change('OpenAI');
		const save = getButton(modal, 'Save').click() as Promise<void>;
		getControl(modal, 'API URL').change('https://retry.example/v1/chat');
		pending.reject(new Error('synthetic persistence failure'));
		await save;

		expect(show).toHaveBeenCalledWith('validation_error', {
			component: 'Provider',
			message: 'Could not save provider settings. Please try again.',
		});
		expect(getControl(modal, 'API URL').value).toBe('https://retry.example/v1/chat');
		expect(getButton(modal, 'Save')).toBeDefined();

		await getButton(modal, 'Save').click();
		expect(onSave).toHaveBeenCalledTimes(2);
		expect(onSave.mock.calls[1]![0]).toMatchObject({
			baseUrl: 'https://retry.example/v1/chat',
		});
	});

	it('keeps draft edits made during a successful save open for a follow-up save', async () => {
		const pending = makeDeferred<void>();
		const onSave = vi
			.fn()
			.mockImplementationOnce(() => pending.promise)
			.mockResolvedValue(undefined);
		const modal = new ProviderModal(new App(), onSave, {
			show: vi.fn(),
		} as unknown as PluginNotices);
		modal.onOpen();
		getControl(modal, 'Provider Preset').change('OpenAI');
		const save = getButton(modal, 'Save').click() as Promise<void>;
		const firstSnapshot = onSave.mock.calls[0]![0] as ProviderConfig;

		getControl(modal, 'API URL').change('https://edited.example/v1/chat');
		getControl(modal, 'API Key').change('edited-key');
		pending.resolve(undefined);
		await save;

		expect(firstSnapshot.baseUrl).toBe('https://api.openai.com/v1/chat/completions');
		expect(firstSnapshot.auth).toBeUndefined();
		expect(firstSnapshot.apiKey).toBe('');
		expect(getControl(modal, 'API URL').value).toBe('https://edited.example/v1/chat');
		expect(getControl(modal, 'API Key').value).toBe('edited-key');
		expect(getButton(modal, 'Save')).toBeDefined();

		await getButton(modal, 'Save').click();
		expect(onSave).toHaveBeenCalledTimes(2);
		expect(onSave.mock.calls[1]![0]).toMatchObject({
			baseUrl: 'https://edited.example/v1/chat',
			apiKey: 'edited-key',
			authType: 'apiKey',
		});
		expect(modal.contentEl.querySelectorAll('button')).toHaveLength(0);
	});

	it('preserves existing provider fields when edited settings are saved', async () => {
		const existingProvider: ProviderConfig = {
			name: 'OpenAI',
			apiKey: 'existing-api-key',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
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

		getControl(modal, 'API URL').change('https://updated.example/v1/chat');
		await getButton(modal, 'Save').click();

		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave).toHaveBeenCalledWith({
			...existingProvider,
			baseUrl: 'https://updated.example/v1/chat',
		});
		expect(existingProvider.name).toBe('OpenAI');
		expect(existingProvider.baseUrl).toBe('https://api.openai.com/v1/chat/completions');
	});

	it('uses structured auth over stale legacy fields when displaying and editing an API key', async () => {
		const existingProvider: ProviderConfig = {
			name: 'OpenAI',
			apiKey: 'stale-legacy-key',
			baseUrl: 'https://existing.example/v1/chat',
			models: [{ id: 'model-1', name: 'Model 1' }],
			temperature: 0.5,
			authType: 'oauth',
			oauth: { ...tokens, accessToken: 'stale-legacy-oauth' },
			auth: { type: 'apiKey', apiKey: 'structured-api-key' },
		};
		const onSave = vi.fn();
		const modal = new ProviderModal(
			new App(),
			onSave,
			{ show: vi.fn() } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();

		const apiKey = getControl(modal, 'API Key');
		expect(apiKey.value).toBe('structured-api-key');
		apiKey.change('updated-structured-key');
		expect((modal as any).providerConfig.auth).toEqual({
			type: 'apiKey',
			apiKey: 'updated-structured-key',
		});
		expect((modal as any).providerConfig.apiKey).toBeUndefined();
		expect((modal as any).providerConfig.oauth).toBeUndefined();

		await getButton(modal, 'Save').click();
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: { type: 'apiKey', apiKey: 'updated-structured-key' },
				models: [{ id: 'model-1', name: 'Model 1' }],
			})
		);
		expect(existingProvider.apiKey).toBe('stale-legacy-key');
		expect(existingProvider.auth).toEqual({ type: 'apiKey', apiKey: 'structured-api-key' });
	});

	it('edits legacy API keys in the legacy shape', async () => {
		const existingProvider: ProviderConfig = {
			name: 'OpenAI',
			apiKey: 'legacy-key',
			baseUrl: 'https://legacy.example/v1/chat',
			models: [],
			temperature: 0.6,
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

		const apiKey = getControl(modal, 'API Key');
		expect(apiKey.value).toBe('legacy-key');
		apiKey.change('updated-legacy-key');
		await getButton(modal, 'Save').click();

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: 'updated-legacy-key',
				authType: 'apiKey',
				auth: undefined,
				oauth: undefined,
			})
		);
		expect(existingProvider.apiKey).toBe('legacy-key');
	});

	it('accepts OAuth tokens into the explicit auth shape instead of stale legacy credentials', async () => {
		const expiredTokens = { ...tokens, expiresAt: 0 };
		const existingProvider: ProviderConfig = {
			name: 'Codex',
			apiKey: 'stale-legacy-key',
			baseUrl: CODEX_OAUTH.API_ENDPOINT,
			models: [],
			temperature: 0.5,
			authType: 'apiKey',
			oauth: { ...expiredTokens, accessToken: 'stale-legacy-oauth' },
			auth: { type: 'oauth', oauth: expiredTokens },
		};
		const modal = new ProviderModal(
			new App(),
			vi.fn(),
			{ show: vi.fn() } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();
		expect(getButton(modal, 'Connect Account')).toBeDefined();
		expect(
			modal.contentEl.querySelectorAll('input').map((input) => input.settingName)
		).not.toContain('API Key');

		vi.spyOn(CodexOAuth.prototype, 'startAuthFlow').mockResolvedValue(tokens);
		await getButton(modal, 'Connect Account').click();

		expect((modal as any).providerConfig.auth).toEqual({ type: 'oauth', oauth: tokens });
		expect((modal as any).providerConfig.authType).toBe('oauth');
		expect((modal as any).providerConfig.apiKey).toBeUndefined();
		expect((modal as any).providerConfig.oauth).toBeUndefined();
		expect(existingProvider.auth).toEqual({ type: 'oauth', oauth: expiredTokens });
	});

	it('clears incompatible credentials when selecting a different preset auth mode', () => {
		const existingProvider: ProviderConfig = {
			name: 'Existing OAuth Provider',
			apiKey: 'stale-legacy-key',
			baseUrl: 'https://existing.example/v1/chat',
			models: [{ id: 'model-1', name: 'Model 1' }],
			temperature: 0.5,
			authType: 'oauth',
			oauth: { ...tokens, accessToken: 'stale-legacy-oauth' },
			auth: { type: 'oauth', oauth: tokens },
		};
		const modal = new ProviderModal(
			new App(),
			vi.fn(),
			{ show: vi.fn() } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();

		getControl(modal, 'Provider Preset').change('OpenAI');
		expect((modal as any).providerConfig.auth).toEqual({ type: 'apiKey', apiKey: '' });
		expect((modal as any).providerConfig.authType).toBe('apiKey');
		expect((modal as any).providerConfig.apiKey).toBeUndefined();
		expect((modal as any).providerConfig.oauth).toBeUndefined();
		expect(getControl(modal, 'API Key').value).toBe('');
		expect((modal as any).providerConfig.models).toEqual([{ id: 'model-1', name: 'Model 1' }]);

		getControl(modal, 'Provider Preset').change('Codex');
		expect((modal as any).providerConfig.auth).toBeUndefined();
		expect((modal as any).providerConfig.authType).toBe('oauth');
		expect((modal as any).providerConfig.apiKey).toBeUndefined();
		expect((modal as any).providerConfig.oauth).toBeUndefined();
		expect(getButton(modal, 'Connect Account')).toBeDefined();
	});

	it('keeps a canceled credential edit in the modal draft only', () => {
		const existingProvider: ProviderConfig = {
			name: 'Legacy Provider',
			apiKey: 'original-key',
			baseUrl: 'https://legacy.example/v1/chat',
			models: [{ id: 'model-1', name: 'Original Model' }],
			temperature: 0.6,
		};
		const onSave = vi.fn();
		const modal = new ProviderModal(
			new App(),
			onSave,
			{ show: vi.fn() } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();
		getControl(modal, 'API Key').change('draft-only-key');
		getButton(modal, 'Cancel').click();

		expect(existingProvider.apiKey).toBe('original-key');
		expect(existingProvider.models[0]?.name).toBe('Original Model');
		expect(onSave).not.toHaveBeenCalled();
	});

	it('retains the modal and reports a fixed safe message when provider persistence rejects', async () => {
		const pending = makeDeferred<void>();
		const show = vi.fn();
		const onSave = vi.fn(() => pending.promise);
		const modal = new ProviderModal(new App(), onSave, { show } as unknown as PluginNotices);
		modal.onOpen();
		getControl(modal, 'Provider Preset').change('OpenAI');
		getControl(modal, 'API URL').change('https://api.example.com/v1/chat');

		const saveButton = getButton(modal, 'Save');
		const save = saveButton.click() as Promise<void>;
		expect(onSave).toHaveBeenCalledOnce();
		expect(saveButton.disabled).toBe(true);
		expect(Notice.startProgress).toHaveBeenCalledWith('Saving provider...');
		pending.reject(new Error('sensitive persistence details'));
		await save;

		expect(show).toHaveBeenCalledWith('validation_error', {
			component: 'Provider',
			message: 'Could not save provider settings. Please try again.',
		});
		expect(
			modal.contentEl.querySelectorAll('button').some((button) => button.textContent === 'Save')
		).toBe(true);
		expect(saveButton.disabled).toBe(false);
		expect(Notice.endProgress).toHaveBeenCalledOnce();
	});

	it('does not update the UI when a pending provider save settles after close', async () => {
		const pending = makeDeferred<void>();
		const show = vi.fn();
		const onSave = vi.fn(() => pending.promise);
		const modal = new ProviderModal(new App(), onSave, { show } as unknown as PluginNotices);
		modal.onOpen();
		getControl(modal, 'Provider Preset').change('OpenAI');
		getControl(modal, 'API URL').change('https://api.example.com/v1/chat');

		const saveButton = getButton(modal, 'Save');
		const save = saveButton.click() as Promise<void>;
		modal.close();
		pending.reject(new Error('late persistence failure'));
		await save;

		expect(show).not.toHaveBeenCalled();
		expect(modal.contentEl.querySelectorAll('button')).toHaveLength(0);
		expect(saveButton.disabled).toBe(false);
		expect(Notice.endProgress).toHaveBeenCalledOnce();
	});

	it('clears every credential source on disconnect and saves an intentional disconnected OAuth draft', async () => {
		const expiredTokens = { ...tokens, expiresAt: 0 };
		const existingProvider: ProviderConfig = {
			name: 'Codex',
			apiKey: 'stale-api-key',
			baseUrl: CODEX_OAUTH.API_ENDPOINT,
			models: [{ id: 'model-1', name: 'Model 1' }],
			temperature: 0.6,
			authType: 'oauth',
			oauth: { ...expiredTokens, accessToken: 'stale-legacy-token' },
			auth: { type: 'oauth', oauth: expiredTokens },
		};
		const onSave = vi.fn();
		const modal = new ProviderModal(
			new App(),
			onSave,
			{ show: vi.fn() } as unknown as PluginNotices,
			existingProvider
		);
		modal.onOpen();

		const pending = makeDeferred<OAuthTokens>();
		const cancelFlow = vi.spyOn(CodexOAuth.prototype, 'cancelFlow');
		vi.spyOn(CodexOAuth.prototype, 'startAuthFlow').mockReturnValue(pending.promise);
		const connection = getButton(modal, 'Connect Account').click() as Promise<void>;
		(modal as any).disconnectOAuth();

		const draft = (modal as any).providerConfig as ProviderConfig;
		expect(cancelFlow).toHaveBeenCalledOnce();
		expect(draft.auth).toBeUndefined();
		expect(draft.apiKey).toBeUndefined();
		expect(draft.oauth).toBeUndefined();
		expect(draft.authType).toBe('oauth');
		expect(draft.baseUrl).toBe(CODEX_OAUTH.API_ENDPOINT);
		expect(draft.models).toEqual([{ id: 'model-1', name: 'Model 1' }]);

		await getButton(modal, 'Save').click();
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Codex',
				authType: 'oauth',
				auth: undefined,
				oauth: undefined,
				apiKey: undefined,
				baseUrl: CODEX_OAUTH.API_ENDPOINT,
			})
		);
		expect(existingProvider.auth).toEqual({ type: 'oauth', oauth: expiredTokens });
		pending.resolve(tokens);
		await connection;
		expect((modal as any).providerConfig.auth).toBeUndefined();
	});
});
