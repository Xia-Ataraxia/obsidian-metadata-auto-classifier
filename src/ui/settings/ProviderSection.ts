import { confirmAction } from './modals/ConfirmModal';
import { Setting as ObsidianSetting, type App } from 'obsidian';

import type AutoClassifierPlugin from '../../main';
import { formatTokenExpiry, isTokenExpired } from '../auth';
import type { ProviderConfig } from '../../types';
import { hasValidAuth } from '../../utils/lib-utils';
import { Setting } from './components/Setting';
import { ProviderModal } from './modals/ProviderModal';

export class ProviderSection {
	constructor(
		private readonly plugin: AutoClassifierPlugin,
		private readonly app: App,
		private readonly onRefresh: () => void
	) {}

	/**
	 * Get display name with OAuth status for a provider
	 */
	private getProviderDisplayInfo(provider: ProviderConfig): { name: string; desc: string } {
		if (provider.authType === 'oauth' || provider.oauth) {
			const isConnected = provider.oauth && !isTokenExpired(provider.oauth);
			const status = isConnected
				? `Signed in · ${formatTokenExpiry(provider.oauth!)}`
				: 'Not signed in';
			return { name: provider.name, desc: status };
		}
		return { name: provider.name, desc: hasValidAuth(provider) ? 'Connected' : 'No API key' };
	}

	render(containerEl: HTMLElement, providers: ProviderConfig[]): void {
		const providerSection = containerEl.createDiv({ cls: 'provider-section' });
		new ObsidianSetting(providerSection).setName('Providers').setHeading();

		providers.forEach((provider) => {
			const displayInfo = this.getProviderDisplayInfo(provider);
			Setting.create(providerSection, {
				name: displayInfo.name,
				desc: displayInfo.desc,
				buttons: [
					{
						icon: 'pencil',
						text: 'Edit',
						onClick: () => this.openProviderModal('edit', provider),
					},
					{
						icon: 'trash',
						text: 'Delete',
						onClick: async () => {
							const confirmed = await confirmAction(
								this.app,
								`Delete "${provider.name}"?`,
								'Delete'
							);
							if (!confirmed) return;

							this.plugin.settings.providers = this.plugin.settings.providers.filter(
								(p) => p.name !== provider.name
							);

							if (this.plugin.settings.selectedProvider === provider.name) {
								this.plugin.settings.selectedProvider = '';
								this.plugin.settings.selectedModel = '';
							}

							await this.plugin.saveSettings();
							this.onRefresh();
						},
					},
				],
			});
		});

		Setting.create(providerSection, {
			name: '',
			button: {
				text: '+ Add provider',
				onClick: () => this.openProviderModal('add'),
			},
		});
	}

	private openProviderModal(type: 'add' | 'edit', providerToEdit?: ProviderConfig): void {
		const modal = new ProviderModal(
			this.app,
			async (savedProvider: ProviderConfig) => {
				if (type === 'add') {
					this.plugin.settings.providers.push(savedProvider);
				} else if (type === 'edit' && providerToEdit) {
					const index = this.plugin.settings.providers.findIndex(
						(p) => p.name === providerToEdit.name
					);
					if (index !== -1) {
						this.plugin.settings.providers[index] = savedProvider;

						if (this.plugin.settings.selectedProvider === providerToEdit.name) {
							this.plugin.settings.selectedProvider = savedProvider.name;
						}
					}
				}
				await this.plugin.saveSettings();
				this.onRefresh();
			},
			this.plugin.notices,
			providerToEdit
		);
		modal.open();
	}
}
