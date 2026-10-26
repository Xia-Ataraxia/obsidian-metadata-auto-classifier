import { confirmAction } from './ConfirmModal';
import type { App } from 'obsidian';
import { ButtonComponent, Modal } from 'obsidian';

import { copyProvider } from '../../../domain/classification-state';
import { getProviderPreset, getProviderPresets } from '../../../utils/lib-utils';
import { CodexOAuth, CODEX_OAUTH } from '../../auth';
import { OAuthError } from '../../auth/oauth';
import type { AuthType, OAuthTokens, ProviderConfig } from '../../../types';
import { ModalAccessibilityHelper } from '../components/ModalAccessibilityHelper';
import { Notice } from '../components/Notice';
import { renderOAuthDeviceCode, renderOAuthSection } from '../components/OAuthControls';
import type { PluginNotices } from '../../plugin-notices';
import { Setting as CommonSetting, type DropdownOption } from '../components/Setting';

export class ProviderModal extends Modal {
	private providerConfig: ProviderConfig;
	private readonly onSave: (provider: ProviderConfig) => void | Promise<void>;
	private readonly notices: PluginNotices;
	private readonly activeProgressNotices = new Set<ReturnType<typeof Notice.startProgress>>();
	private readonly accessibilityHelper = new ModalAccessibilityHelper();
	private readonly codexOAuth = new CodexOAuth();
	private readonly structuredAuth: boolean;
	private oauthTokens?: OAuthTokens;
	private modalOpen = false;
	private modalGeneration = 0;
	private saveInProgress = false;
	private draftRevision = 0;
	private oauthFlowGeneration = 0;
	private oauthFlowActive = false;
	private disconnectedOAuth = false;

	constructor(
		app: App,
		onSave: (provider: ProviderConfig) => void | Promise<void>,
		notices: PluginNotices,
		existingProvider?: ProviderConfig
	) {
		super(app);
		this.onSave = onSave;
		this.notices = notices;
		this.structuredAuth = existingProvider?.auth !== undefined;

		if (existingProvider) {
			this.providerConfig = copyProvider(existingProvider);
			if (this.getRequiredAuthMode() === 'oauth' && this.getAuthMode() === 'oauth') {
				this.oauthTokens = this.getStoredOAuthTokens();
			}
		} else {
			this.providerConfig = {
				name: 'Custom Provider',
				apiKey: '',
				baseUrl: '',
				models: [],
				temperature: 0.7,
			};
		}
	}

	onOpen(): void {
		this.modalOpen = true;
		this.modalGeneration++;
		this.saveInProgress = false;
		const { contentEl } = this;
		contentEl.empty();

		// Accessibility: Set modal role and label
		contentEl.setAttribute('role', 'dialog');
		contentEl.setAttribute('aria-modal', 'true');
		contentEl.setAttribute('aria-label', 'Provider settings');

		this.setTitle('Provider settings');

		// Always show preset selection
		this.addPresetSetting(contentEl);

		// Provider form
		this.addProviderForm(contentEl);

		// Buttons
		this.addButtons(contentEl);

		// Accessibility: Focus first input and setup keyboard navigation
		this.setupAccessibility(contentEl);
	}

	private setupAccessibility(contentEl: HTMLElement): void {
		this.accessibilityHelper.setup(contentEl);
	}

	private addPresetSetting(containerEl: HTMLElement): void {
		const presets = getProviderPresets();
		const presetOptions: DropdownOption[] = presets.map((preset) => ({
			value: preset.name,
			display: preset.name,
		}));

		// Match exact preset identity; custom URLs must not infer or rename a provider adapter.
		const currentValue = presets.some((preset) => preset.name === this.providerConfig.name)
			? this.providerConfig.name
			: 'Custom Provider';

		CommonSetting.create(containerEl, {
			name: 'Provider preset',
			desc: 'Start from a known provider, or pick Custom Provider.',
			dropdown: {
				options: presetOptions,
				value: currentValue,
				onChange: (providerName) => {
					this.loadPresetData(providerName);
				},
			},
		});
	}

	/**
	 * Check if the current provider uses OAuth authentication
	 */
	private isOAuthProvider(): boolean {
		return this.getRequiredAuthMode() === 'oauth';
	}

	private getRequiredAuthMode(): AuthType | undefined {
		const preset = getProviderPresets().find((p) => p.name === this.providerConfig.name);
		if (!preset) return undefined;
		return preset.authType === 'oauth' ? 'oauth' : 'apiKey';
	}

	private getAuthMode(): AuthType | undefined {
		const explicitAuth: unknown = this.providerConfig.auth;
		if (explicitAuth !== undefined) {
			if (!explicitAuth || typeof explicitAuth !== 'object' || Array.isArray(explicitAuth))
				return undefined;
			const auth = explicitAuth as { type?: unknown; apiKey?: unknown; oauth?: unknown };
			if (auth.type === 'apiKey' && typeof auth.apiKey === 'string') return 'apiKey';
			if (auth.type === 'oauth' && this.isOAuthTokens(auth.oauth)) return 'oauth';
			return undefined;
		}
		if (this.providerConfig.authType !== undefined) {
			return this.providerConfig.authType === 'apiKey' || this.providerConfig.authType === 'oauth'
				? this.providerConfig.authType
				: undefined;
		}
		const preset = getProviderPresets().find((p) => p.name === this.providerConfig.name);
		return preset?.authType ?? (this.providerConfig.oauth ? 'oauth' : 'apiKey');
	}

	private isOAuthTokens(value: unknown): value is OAuthTokens {
		if (!value || typeof value !== 'object') return false;
		const tokens = value as Partial<OAuthTokens>;
		return (
			typeof tokens.accessToken === 'string' &&
			typeof tokens.refreshToken === 'string' &&
			typeof tokens.expiresAt === 'number' &&
			typeof tokens.accountId === 'string'
		);
	}

	private getStoredOAuthTokens(): OAuthTokens | undefined {
		const explicitAuth: unknown = this.providerConfig.auth;
		if (explicitAuth !== undefined) {
			if (!explicitAuth || typeof explicitAuth !== 'object' || Array.isArray(explicitAuth))
				return undefined;
			const auth = explicitAuth as { type?: unknown; oauth?: unknown };
			return auth.type === 'oauth' && this.isOAuthTokens(auth.oauth) ? auth.oauth : undefined;
		}
		if (this.providerConfig.authType === 'apiKey') return undefined;
		return this.providerConfig.oauth;
	}

	private getApiKey(): string {
		const explicitAuth: unknown = this.providerConfig.auth;
		if (explicitAuth !== undefined) {
			if (!explicitAuth || typeof explicitAuth !== 'object' || Array.isArray(explicitAuth))
				return '';
			const auth = explicitAuth as { type?: unknown; apiKey?: unknown };
			return auth.type === 'apiKey' && typeof auth.apiKey === 'string' ? auth.apiKey : '';
		}
		if (this.providerConfig.authType)
			return this.providerConfig.authType === 'apiKey' ? (this.providerConfig.apiKey ?? '') : '';
		if (this.providerConfig.oauth) return '';
		return this.providerConfig.apiKey ?? '';
	}

	private applyAuthMode(mode: AuthType): void {
		const apiKey = this.getApiKey();
		this.providerConfig.authType = mode;

		if (this.structuredAuth) {
			this.providerConfig.apiKey = undefined;
			this.providerConfig.oauth = undefined;
			this.providerConfig.auth =
				mode === 'apiKey'
					? { type: 'apiKey', apiKey }
					: this.oauthTokens
						? { type: 'oauth', oauth: { ...this.oauthTokens } }
						: undefined;
			return;
		}

		this.providerConfig.auth = undefined;
		if (mode === 'apiKey') {
			this.providerConfig.apiKey = apiKey;
			this.providerConfig.oauth = undefined;
			this.oauthTokens = undefined;
		} else {
			this.providerConfig.apiKey = undefined;
			this.providerConfig.oauth = this.oauthTokens ? { ...this.oauthTokens } : undefined;
		}
	}

	private clearCredentialSources(): void {
		this.providerConfig.auth = undefined;
		this.providerConfig.apiKey = undefined;
		this.providerConfig.oauth = undefined;
	}

	private markDraftChanged(): void {
		this.draftRevision++;
	}

	private invalidateOAuthFlow(): void {
		this.oauthFlowGeneration++;
		if (this.oauthFlowActive) this.codexOAuth.cancelFlow();
		this.oauthFlowActive = false;
	}

	private addProviderForm(containerEl: HTMLElement): void {
		// Show the selected preset's provider name as a read-only setting.
		const presets = getProviderPresets();
		CommonSetting.create(containerEl, {
			name: 'Provider name',
			desc: this.providerConfig.name,
		});

		// API URL
		CommonSetting.create(containerEl, {
			name: 'API URL',
			desc: 'The full endpoint URL, like https://api.openai.com/v1/chat/completions.',
			textInput: {
				placeholder: 'https://api.example.com/v1/chat/completions',
				value: this.providerConfig.baseUrl,
				onChange: (value) => {
					this.providerConfig.baseUrl = value;
					this.markDraftChanged();
				},
			},
		});

		const preset = presets.find((p) => p.name === this.providerConfig.name);

		// Show OAuth or API Key based on provider type
		if (this.isOAuthProvider()) {
			renderOAuthSection(
				containerEl,
				this.oauthTokens,
				() => this.connectOAuth(),
				() => this.disconnectOAuth()
			);
		} else {
			CommonSetting.create(containerEl, {
				name: 'API key',
				desc: 'Your API key for this provider.',
				textInput: {
					placeholder: 'Enter API key',
					password: true,
					value: this.getApiKey(),
					onChange: (value) => {
						this.providerConfig.authType = 'apiKey';
						this.oauthTokens = undefined;
						this.disconnectedOAuth = false;
						if (this.structuredAuth) {
							this.providerConfig.auth = { type: 'apiKey', apiKey: value };
							this.providerConfig.apiKey = undefined;
							this.providerConfig.oauth = undefined;
						} else {
							this.providerConfig.auth = undefined;
							this.providerConfig.apiKey = value;
							this.providerConfig.oauth = undefined;
						}
						this.markDraftChanged();
					},
				},
			});

			// Add link manually if preset has apiKeyUrl
			if (preset?.apiKeyUrl) {
				const settingEl = containerEl.querySelector(
					'.setting-item:last-child .setting-item-description'
				);
				settingEl?.createEl('a', {
					cls: 'mac-api-key-link',
					text: 'Get an API key',
					href: preset.apiKeyUrl,
					attr: { target: '_blank' },
				});
			}
		}
	}

	private showDeviceCode(userCode: string): void {
		this.contentEl.querySelector('.oauth-device-code')?.remove();
		renderOAuthDeviceCode(this.contentEl, userCode, () =>
			window.open(CODEX_OAUTH.DEVICE_VERIFICATION_URI, '_blank')
		);
	}

	/**
	 * Start OAuth connection flow
	 */
	private async connectOAuth(): Promise<void> {
		const flowGeneration = ++this.oauthFlowGeneration;
		this.oauthFlowActive = true;
		try {
			const tokens = await this.codexOAuth.startAuthFlow(({ userCode }) => {
				if (
					this.modalOpen &&
					flowGeneration === this.oauthFlowGeneration &&
					this.isOAuthProvider()
				) {
					this.showDeviceCode(userCode);
				}
			});
			if (flowGeneration !== this.oauthFlowGeneration) return;
			this.oauthFlowActive = false;
			if (!this.modalOpen || !this.isOAuthProvider()) return;
			this.contentEl.querySelector('.oauth-device-code')?.remove();
			this.oauthTokens = tokens;
			this.disconnectedOAuth = false;
			this.applyAuthMode('oauth');
			this.markDraftChanged();

			this.notices.show('oauth_connected');
			this.updateForm();
		} catch (error) {
			if (flowGeneration !== this.oauthFlowGeneration) return;
			this.oauthFlowActive = false;
			if (!this.modalOpen) return;
			this.contentEl.querySelector('.oauth-device-code')?.remove();
			if (error instanceof OAuthError && error.code === 'cancelled') {
				this.notices.show('oauth_cancelled');
			} else {
				const message =
					error instanceof OAuthError && error.code === 'disabled'
						? 'Device-code sign-in is unavailable. Check account or workspace settings.'
						: error instanceof OAuthError && error.code === 'timeout'
							? 'Authentication timed out. Please start again.'
							: error instanceof OAuthError && error.code === 'invalid'
								? 'The authentication response was invalid. Please retry.'
								: 'Authentication could not be completed. Check the account configuration.';
				this.notices.show('oauth_failed', {
					message,
				});
			}
		}
	}

	/**
	 * Disconnect OAuth
	 */
	private async disconnectOAuth(): Promise<void> {
		const modalGeneration = this.modalGeneration;
		const confirmed = await confirmAction(this.app, 'Disconnect this account?', 'Disconnect');
		if (!confirmed || !this.isCurrentModal(modalGeneration)) return;
		this.invalidateOAuthFlow();
		this.contentEl.querySelector('.oauth-device-code')?.remove();
		this.oauthTokens = undefined;
		this.clearCredentialSources();
		this.providerConfig.authType = 'oauth';
		this.disconnectedOAuth = true;
		this.markDraftChanged();

		this.notices.show('oauth_disconnected');
		this.updateForm();
	}

	private addButtons(containerEl: HTMLElement): void {
		const buttonContainer = containerEl.createDiv({ cls: 'button-container mac-button-container' });

		new ButtonComponent(buttonContainer).setButtonText('Cancel').onClick(() => this.close());

		const saveBtn = new ButtonComponent(buttonContainer)
			.setButtonText('Save')
			.setCta()
			.onClick(async () => {
				if (!this.modalOpen || this.saveInProgress) return;
				this.saveInProgress = true;
				const modalGeneration = this.modalGeneration;
				saveBtn.setDisabled(true);
				let notice: ReturnType<typeof Notice.startProgress> | undefined;
				const draftRevision = this.draftRevision;
				const saveSnapshot = copyProvider(this.providerConfig);
				try {
					notice = Notice.startProgress('Saving provider...');
					this.activeProgressNotices.add(notice);
					if (!this.validateForm()) return;
					await this.onSave(saveSnapshot);
					if (this.isCurrentModal(modalGeneration) && this.draftRevision === draftRevision) {
						this.close();
					}
				} catch {
					if (this.isCurrentModal(modalGeneration)) {
						this.notices.show('validation_error', {
							component: 'Provider',
							message: 'Could not save provider settings. Please try again.',
						});
					}
				} finally {
					try {
						if (notice && this.activeProgressNotices.has(notice)) {
							try {
								Notice.endProgress(notice);
							} finally {
								this.activeProgressNotices.delete(notice);
							}
						}
					} finally {
						saveBtn.setDisabled(false);
						if (this.isCurrentModal(modalGeneration)) this.saveInProgress = false;
					}
				}
			});
	}

	private isCurrentModal(generation: number): boolean {
		return this.modalOpen && this.modalGeneration === generation;
	}

	private loadPresetData(providerName: string): void {
		const preset = getProviderPreset(providerName);
		const nextMode: AuthType = preset.authType === 'oauth' ? 'oauth' : 'apiKey';
		if (this.providerConfig.name !== preset.name || this.getAuthMode() !== nextMode) {
			this.invalidateOAuthFlow();
			this.oauthTokens = undefined;
			this.disconnectedOAuth = false;
			this.clearCredentialSources();
		}

		this.providerConfig.name = preset.name;
		this.providerConfig.baseUrl = preset.baseUrl;
		this.providerConfig.temperature = preset.temperature;
		this.applyAuthMode(nextMode);
		this.markDraftChanged();

		// For OAuth providers, use the special endpoint
		if (preset.authType === 'oauth' && preset.name === 'Codex') {
			this.providerConfig.baseUrl = CODEX_OAUTH.API_ENDPOINT;
		}

		// Update the form to reflect new data
		this.updateForm();
	}

	private updateForm(): void {
		// Find and update form elements
		const formElements = this.contentEl.querySelectorAll('.setting-item');

		// Remove form elements (keep preset dropdown - index 0)
		for (let i = formElements.length - 1; i >= 1; i--) {
			formElements[i]!.remove();
		}

		// Remove OAuth info element if exists
		const oauthInfo = this.contentEl.querySelector('.oauth-connection-info');
		if (oauthInfo) {
			oauthInfo.remove();
		}
		this.contentEl.querySelector('.oauth-device-code')?.remove();

		// Re-add form elements with updated data
		this.addProviderForm(this.contentEl);

		// Re-add buttons
		const existingButtons = this.contentEl.querySelector('.button-container');
		if (existingButtons) {
			existingButtons.remove();
		}
		this.addButtons(this.contentEl);
	}

	private validateForm(): boolean {
		// Provider name validation
		if (!this.providerConfig.name.trim()) {
			this.notices.show('validation_error', {
				component: 'Provider',
				message: 'Enter a provider name.',
			});
			return false;
		}
		if (!getProviderPresets().some((preset) => preset.name === this.providerConfig.name)) {
			this.notices.show('validation_error', {
				component: 'Provider',
				message: 'Select a supported provider preset before saving.',
			});
			return false;
		}
		const requiredAuthMode = this.getRequiredAuthMode();
		const configuredAuthMode = this.getAuthMode();
		if (requiredAuthMode && configuredAuthMode !== requiredAuthMode) {
			this.notices.show('validation_error', {
				component: 'Provider',
				message:
					requiredAuthMode === 'oauth'
						? 'Connect this provider with OAuth or select a compatible preset.'
						: 'Enter an API key for this provider or select a compatible preset.',
			});
			return false;
		}

		// API URL validation
		if (!this.providerConfig.baseUrl.trim()) {
			this.notices.show('validation_error', {
				component: 'Provider',
				message: 'Enter an API URL.',
			});
			return false;
		}

		// Basic URL validation
		try {
			new URL(this.providerConfig.baseUrl);
		} catch {
			this.notices.show('validation_error', {
				component: 'Provider',
				message: 'Enter a valid URL, like https://api.example.com/v1/chat/completions.',
			});
			return false;
		}

		// For OAuth providers, check if connected
		if (this.isOAuthProvider()) {
			if (!this.oauthTokens && !this.disconnectedOAuth) {
				this.notices.show('validation_error', {
					component: 'Provider',
					message: 'Connect your account before saving.',
				});
				return false;
			}
		}

		return true;
	}

	onClose(): void {
		this.modalOpen = false;
		this.modalGeneration++;
		this.saveInProgress = false;
		const progressNotices = [...this.activeProgressNotices];
		this.activeProgressNotices.clear();
		for (const notice of progressNotices) Notice.endProgress(notice);
		this.invalidateOAuthFlow();
		const { contentEl } = this;
		this.accessibilityHelper.cleanup(contentEl);
		contentEl.empty();
	}
}
