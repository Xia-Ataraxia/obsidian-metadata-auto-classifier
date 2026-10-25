import type { App } from 'obsidian';
import { ButtonComponent, Modal } from 'obsidian';

import { getProviderPreset, getProviderPresets } from '../../../utils/lib-utils';
import { CodexOAuth, formatTokenExpiry, isTokenExpired, CODEX_OAUTH } from '../../auth';
import { OAuthError } from '../../auth/oauth';
import type { OAuthTokens, ProviderConfig } from '../../../types';
import { ModalAccessibilityHelper } from '../components/ModalAccessibilityHelper';
import { Notice } from '../components/Notice';
import type { PluginNotices } from '../../plugin-notices';
import { Setting as CommonSetting, type DropdownOption } from '../components/Setting';

export class ProviderModal extends Modal {
	private providerConfig: ProviderConfig;
	private readonly onSave: (provider: ProviderConfig) => void | Promise<void>;
	private readonly notices: PluginNotices;
	private readonly accessibilityHelper = new ModalAccessibilityHelper();
	private readonly codexOAuth = new CodexOAuth();
	private oauthTokens?: OAuthTokens;
	private modalOpen = false;
	private oauthFlowGeneration = 0;

	constructor(
		app: App,
		onSave: (provider: ProviderConfig) => void | Promise<void>,
		notices: PluginNotices,
		existingProvider?: ProviderConfig
	) {
		super(app);
		this.onSave = onSave;
		this.notices = notices;

		if (existingProvider) {
			this.providerConfig = { ...existingProvider };
			// Preserve OAuth tokens from existing provider
			this.oauthTokens = existingProvider.oauth;
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
		const { contentEl } = this;
		contentEl.empty();

		// Accessibility: Set modal role and label
		contentEl.setAttribute('role', 'dialog');
		contentEl.setAttribute('aria-modal', 'true');
		contentEl.setAttribute('aria-label', 'Provider settings');

		// Modal title - unified
		contentEl.createEl('h2', { text: 'Provider settings' });

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

		// Determine current preset value
		const currentValue = this.providerConfig.name || 'Custom Provider';

		CommonSetting.create(containerEl, {
			name: 'Provider Preset',
			desc: 'Select a predefined provider',
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
		const preset = getProviderPresets().find((p) => p.name === this.providerConfig.name);
		return preset?.authType === 'oauth' || this.providerConfig.authType === 'oauth';
	}

	private addProviderForm(containerEl: HTMLElement): void {
		// Provider Name - always editable, but show hint if it matches preset
		const presets = getProviderPresets();
		const isPresetProvider = presets.some((preset) => preset.name === this.providerConfig.name);

		CommonSetting.create(containerEl, {
			name: 'Provider Name',
			desc: isPresetProvider
				? 'Provider name (from preset)'
				: 'Enter a unique name for your provider',
			textInput: {
				placeholder: 'Enter provider name',
				value: this.providerConfig.name,
				disabled: false,
				onChange: (value) => {
					this.providerConfig.name = value;
				},
			},
		});

		// API URL
		CommonSetting.create(containerEl, {
			name: 'API URL',
			desc: 'The complete API URL including endpoint (e.g., https://api.openai.com/v1/chat/completions)',
			textInput: {
				placeholder: 'https://api.example.com/v1/chat/completions',
				value: this.providerConfig.baseUrl,
				onChange: (value) => {
					this.providerConfig.baseUrl = value;
				},
			},
		});

		const preset = presets.find((p) => p.name === this.providerConfig.name);

		// Show OAuth or API Key based on provider type
		if (this.isOAuthProvider()) {
			this.addOAuthSection(containerEl);
		} else {
			CommonSetting.create(containerEl, {
				name: 'API Key',
				desc: 'Your API key for this provider',
				textInput: {
					placeholder: 'Enter API key',
					value: this.providerConfig.apiKey ?? '',
					onChange: (value) => {
						this.providerConfig.apiKey = value;
					},
				},
			});

			// Add link manually if preset has apiKeyUrl
			if (preset?.apiKeyUrl) {
				const settingEl = containerEl.querySelector(
					'.setting-item:last-child .setting-item-description'
				);
				if (settingEl) {
					const linkEl = document.createElement('a');
					linkEl.href = preset.apiKeyUrl;
					linkEl.target = '_blank';
					linkEl.className = 'mac-api-key-link';
					linkEl.textContent = 'Get your API key here';
					settingEl.appendChild(linkEl);
				}
			}
		}
	}

	/**
	 * Add OAuth authentication section for providers like Codex
	 */
	private addOAuthSection(containerEl: HTMLElement): void {
		const isConnected = this.oauthTokens && !isTokenExpired(this.oauthTokens);
		const statusText = isConnected
			? `Connected (${formatTokenExpiry(this.oauthTokens!)})`
			: 'Not connected';

		CommonSetting.create(containerEl, {
			name: 'Authentication',
			desc: isConnected ? statusText : 'Connect your account to use this provider',
			button: {
				text: isConnected ? 'Disconnect' : 'Connect Account',
				warning: isConnected,
				onClick: isConnected ? () => this.disconnectOAuth() : () => this.connectOAuth(),
			},
		});

		// Explain account-level availability without implying eligibility.
		if (!isConnected) {
			const infoEl = containerEl.createEl('div', {
				cls: 'setting-item-description oauth-connection-info',
			});
			infoEl.setCssProps({
				'margin-top': '-8px',
				'margin-bottom': '16px',
				'padding-left': '16px',
				color: 'var(--text-muted)',
			});
			infoEl.textContent = 'Device-code sign-in may be disabled by account or workspace settings.';
		}
	}

	private showDeviceCode(userCode: string): void {
		this.contentEl.querySelector('.oauth-device-code')?.remove();
		const section = this.contentEl.createDiv({ cls: 'oauth-device-code' });
		section.createEl('p', {
			text: `Enter this one-time code at ${CODEX_OAUTH.DEVICE_VERIFICATION_URI}.`,
		});
		section.createEl('code', { text: userCode });
		new ButtonComponent(section)
			.setButtonText('Open verification page')
			.onClick(() => window.open(CODEX_OAUTH.DEVICE_VERIFICATION_URI, '_blank'));
	}

	/**
	 * Start OAuth connection flow
	 */
	private async connectOAuth(): Promise<void> {
		const flowGeneration = ++this.oauthFlowGeneration;
		try {
			const tokens = await this.codexOAuth.startAuthFlow(({ userCode }) => {
				if (this.modalOpen && flowGeneration === this.oauthFlowGeneration) {
					this.showDeviceCode(userCode);
				}
			});
			if (flowGeneration !== this.oauthFlowGeneration) return;
			this.contentEl.querySelector('.oauth-device-code')?.remove();
			this.oauthTokens = tokens;

			// Update provider config
			this.providerConfig.authType = 'oauth';
			this.providerConfig.oauth = tokens;

			this.notices.show('oauth_connected');
			this.updateForm();
		} catch (error) {
			if (flowGeneration !== this.oauthFlowGeneration) return;
			this.contentEl.querySelector('.oauth-device-code')?.remove();
			if (error instanceof OAuthError && error.code === 'cancelled') {
				if (!this.modalOpen) return;
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
	private disconnectOAuth(): void {
		// eslint-disable-next-line no-alert -- confirm() used intentionally for destructive action; modal refactor is out of scope
		const confirmed = confirm('Are you sure you want to disconnect?');
		if (!confirmed) return;

		this.oauthTokens = undefined;
		this.providerConfig.oauth = undefined;

		this.notices.show('oauth_disconnected');
		this.updateForm();
	}

	private addButtons(containerEl: HTMLElement): void {
		const buttonContainer = containerEl.createDiv({ cls: 'button-container mac-button-container' });

		new ButtonComponent(buttonContainer).setButtonText('Cancel').onClick(() => this.close());

		const saveBtn = new ButtonComponent(buttonContainer)
			.setButtonText('Save')
			.setCta()
			.onClick(() => {
				const notice = Notice.startProgress('Saving provider...');
				saveBtn.setDisabled(true);
				try {
					if (this.validateForm()) {
						void this.onSave(this.providerConfig);
						this.close();
					}
				} finally {
					Notice.endProgress(notice);
					saveBtn.setDisabled(false);
				}
			});
	}

	private loadPresetData(providerName: string): void {
		const preset = getProviderPreset(providerName);

		this.providerConfig.name = preset.name;
		this.providerConfig.baseUrl = preset.baseUrl;
		this.providerConfig.temperature = preset.temperature;
		this.providerConfig.authType = preset.authType;

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
				message: 'Provider name is required. Please enter a name for your provider.',
			});
			return false;
		}

		// API URL validation
		if (!this.providerConfig.baseUrl.trim()) {
			this.notices.show('validation_error', {
				component: 'Provider',
				message: 'API URL is required. Please enter a valid API endpoint URL.',
			});
			return false;
		}

		// Basic URL validation
		try {
			new URL(this.providerConfig.baseUrl);
		} catch {
			this.notices.show('validation_error', {
				component: 'Provider',
				message: 'Please enter a valid URL (e.g., https://api.example.com/v1/chat/completions)',
			});
			return false;
		}

		// For OAuth providers, check if connected
		if (this.isOAuthProvider()) {
			if (!this.oauthTokens) {
				this.notices.show('validation_error', {
					component: 'Provider',
					message: 'Please connect your account before saving.',
				});
				return false;
			}
		}

		return true;
	}

	onClose(): void {
		this.modalOpen = false;
		this.oauthFlowGeneration++;
		const { contentEl } = this;
		this.accessibilityHelper.cleanup(contentEl);
		this.codexOAuth.cancelFlow();
		contentEl.empty();
	}
}
