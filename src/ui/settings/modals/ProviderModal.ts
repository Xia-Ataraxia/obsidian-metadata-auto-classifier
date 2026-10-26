import { confirmAction } from './ConfirmModal';
import type { App } from 'obsidian';
import { ButtonComponent, Modal, Platform } from 'obsidian';

import { findMatchingPreset, getProviderPreset, getProviderPresets } from '../../../utils/lib-utils';
import { CodexOAuth, formatTokenExpiry, isTokenExpired, CODEX_OAUTH } from '../../auth';
import type { OAuthTokens, ProviderConfig } from '../../../types';
import { ModalAccessibilityHelper } from '../components/ModalAccessibilityHelper';
import type { PluginNotices } from '../../plugin-notices';
import { Setting as CommonSetting, type DropdownOption } from '../components/Setting';

export class ProviderModal extends Modal {
	private providerConfig: ProviderConfig;
	private readonly onSave: (provider: ProviderConfig) => void | Promise<void>;
	private readonly notices: PluginNotices;
	private readonly accessibilityHelper = new ModalAccessibilityHelper();
	private readonly codexOAuth = new CodexOAuth();
	private oauthTokens?: OAuthTokens;

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

		// Unknown names (hand-made providers) fall back to Custom Provider so the dropdown is never blank.
		const currentValue = findMatchingPreset(this.providerConfig);

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
		const preset = getProviderPresets().find((p) => p.name === this.providerConfig.name);
		return preset?.authType === 'oauth' || this.providerConfig.authType === 'oauth';
	}

	private addProviderForm(containerEl: HTMLElement): void {
		// Provider Name - always editable, but show hint if it matches preset
		const presets = getProviderPresets();
		const isPresetProvider = presets.some((preset) => preset.name === this.providerConfig.name);

		CommonSetting.create(containerEl, {
			name: 'Provider name',
			desc: isPresetProvider
				? 'Filled in from the preset.'
				: 'A unique name for this provider.',
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
			desc: 'The full endpoint URL, like https://api.openai.com/v1/chat/completions.',
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
				name: 'API key',
				desc: 'Your API key for this provider.',
				textInput: {
					placeholder: 'Enter API key',
					password: true,
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
				settingEl?.createEl('a', {
					cls: 'mac-api-key-link',
					text: 'Get an API key',
					href: preset.apiKeyUrl,
					attr: { target: '_blank' },
				});
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

		// Desktop-only notice for OAuth
		if (!Platform.isDesktop) {
			CommonSetting.create(containerEl, {
				name: 'Authentication',
				desc: 'OAuth authentication requires the desktop app.',
			});
			return;
		}

		CommonSetting.create(containerEl, {
			name: 'Authentication',
			desc: isConnected ? statusText : 'Connect your account to use this provider',
			button: {
				text: isConnected ? 'Disconnect' : 'Connect account',
				warning: isConnected,
				onClick: isConnected ? () => void this.disconnectOAuth() : () => this.connectOAuth(),
			},
		});

		// Add info text about requirements
		if (!isConnected) {
			const infoEl = containerEl.createDiv({
				cls: 'setting-item-description oauth-connection-info',
			});
			const plan = 'ChatGPT Pro';
			infoEl.textContent = `Requires a ${plan} subscription`;
		}
	}

	/**
	 * Start OAuth connection flow
	 */
	private async connectOAuth(): Promise<void> {
		try {
			this.notices.show('oauth_opening_browser');

			const tokens = await this.codexOAuth.startAuthFlow();
			this.oauthTokens = tokens;

			// Update provider config
			this.providerConfig.authType = 'oauth';
			this.providerConfig.oauth = tokens;

			this.notices.show('oauth_connected');
			this.updateForm();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			if (message.includes('timeout') || message.includes('cancelled')) {
				this.notices.show('oauth_cancelled');
			} else {
				this.notices.show('oauth_failed', { message });
			}
		}
	}

	/**
	 * Disconnect OAuth
	 */
	private async disconnectOAuth(): Promise<void> {
		const confirmed = await confirmAction(this.app, 'Disconnect this account?', 'Disconnect');
		if (!confirmed) return;

		this.oauthTokens = undefined;
		this.providerConfig.oauth = undefined;

		this.notices.show('oauth_disconnected');
		this.updateForm();
	}

	private addButtons(containerEl: HTMLElement): void {
		const buttonContainer = containerEl.createDiv({ cls: 'button-container mac-button-container' });

		new ButtonComponent(buttonContainer).setButtonText('Cancel').onClick(() => this.close());

		new ButtonComponent(buttonContainer)
			.setButtonText('Save')
			.setCta()
			.onClick(() => {
				if (this.validateForm()) {
					void this.onSave(this.providerConfig);
					this.close();
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
		if (this.isOAuthProvider() && Platform.isDesktop) {
			if (!this.oauthTokens) {
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
		const { contentEl } = this;
		this.accessibilityHelper.cleanup(contentEl);
		this.codexOAuth.cancelFlow();
		contentEl.empty();
	}
}
