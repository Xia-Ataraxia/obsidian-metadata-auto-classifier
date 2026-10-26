import { confirmAction } from './modals/ConfirmModal';
import { Setting as ObsidianSetting, type App } from 'obsidian';

import type AutoClassifierPlugin from '../../main';
import { copyProvider, providerHasAuth, sameProvider } from '../../domain/classification-state';
import type { ProviderConfig } from '../../types';
import { formatTokenExpiry, isTokenExpired } from '../auth';
import { findUniqueProvider } from '../../utils/lib-utils';
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
		const authType =
			provider.auth !== undefined
				? provider.auth.type
				: (provider.authType ?? (provider.oauth ? 'oauth' : undefined));
		if (authType === 'oauth') {
			const oauthTokens =
				provider.auth !== undefined
					? provider.auth.type === 'oauth'
						? provider.auth.oauth
						: undefined
					: provider.oauth;
			const isConnected = oauthTokens && !isTokenExpired(oauthTokens);
			const status = isConnected
				? `Signed in · ${formatTokenExpiry(oauthTokens!)}`
				: 'Not signed in';
			return { name: provider.name, desc: status };
		}
		return { name: provider.name, desc: providerHasAuth(provider) ? 'Connected' : 'No API key' };
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
							if (!confirmed || !this.plugin.isActive()) return;

							const providers = this.plugin.settings.providers;
							if (findUniqueProvider(providers, provider.name) !== provider) return;
							const selectedProvider = this.plugin.settings.selectedProvider;
							const selectedModel = this.plugin.settings.selectedModel;
							const removedSnapshot = copyProvider(provider);
							const providerIndex = providers.indexOf(provider);
							if (providerIndex === -1) return;
							const remainingProviders = providers.slice();
							remainingProviders.splice(providerIndex, 1);
							this.plugin.settings.providers = remainingProviders;

							const clearedSelection =
								this.plugin.settings.selectedProvider === provider.name &&
								!remainingProviders.some((p) => p.name === provider.name);
							if (clearedSelection) {
								this.plugin.settings.selectedProvider = '';
								this.plugin.settings.selectedModel = '';
							}

							try {
								await this.plugin.saveSettings();
							} catch (error) {
								let restoredProvider = false;
								if (
									this.plugin.settings.providers === remainingProviders &&
									!remainingProviders.includes(provider) &&
									sameProvider(provider, removedSnapshot)
								) {
									remainingProviders.splice(
										Math.min(providerIndex, remainingProviders.length),
										0,
										provider
									);
									restoredProvider = true;
								}
								if (
									restoredProvider &&
									clearedSelection &&
									this.plugin.settings.selectedProvider === '' &&
									this.plugin.settings.selectedModel === ''
								) {
									this.plugin.settings.selectedProvider = selectedProvider;
									this.plugin.settings.selectedModel = selectedModel;
								}
								throw error;
							}
							if (!this.plugin.isActive()) return;
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
		let saveType = type;
		let saveTarget = providerToEdit;
		let saveTargetBaseline = providerToEdit ? copyProvider(providerToEdit) : undefined;
		const modal = new ProviderModal(
			this.app,
			async (savedProvider: ProviderConfig) => {
				if (!this.plugin.isActive()) throw new Error('The plugin is no longer active.');
				const providers = this.plugin.settings.providers;
				const previousSelectedProvider = this.plugin.settings.selectedProvider;
				const previousTarget = saveTarget;
				const previousTargetBaseline = saveTargetBaseline;
				const writtenSnapshot = copyProvider(savedProvider);
				let nextProviders: ProviderConfig[];
				let nextSelectedProvider = previousSelectedProvider;

				if (saveType === 'add') {
					if (providers.some((provider) => provider.name === savedProvider.name)) {
						throw new Error('A provider with this name already exists.');
					}
					nextProviders = [...providers, savedProvider];
				} else if (saveType === 'edit' && previousTarget) {
					const index = providers.indexOf(previousTarget);
					if (
						index === -1 ||
						findUniqueProvider(providers, previousTarget.name) !== previousTarget ||
						providers.filter((provider) => provider === previousTarget).length !== 1 ||
						!previousTargetBaseline ||
						!sameProvider(previousTarget, previousTargetBaseline)
					) {
						throw new Error('The provider being edited has changed. Reopen it before saving.');
					}
					if (
						providers.some(
							(provider, providerIndex) =>
								providerIndex !== index && provider.name === savedProvider.name
						)
					) {
						throw new Error('A provider with this name already exists.');
					}
					nextProviders = providers.slice();
					nextProviders[index] = savedProvider;
					if (previousSelectedProvider === previousTarget.name)
						nextSelectedProvider = savedProvider.name;
				} else {
					throw new Error('The provider edit is invalid.');
				}

				this.plugin.settings.providers = nextProviders;
				this.plugin.settings.selectedProvider = nextSelectedProvider;
				try {
					await this.plugin.saveSettings();
				} catch (error) {
					if (!this.plugin.isActive()) throw error;
					let restoredProvider = false;
					const currentProviders = this.plugin.settings.providers;
					const writtenIndexes = currentProviders.flatMap((provider, index) =>
						provider === savedProvider ? [index] : []
					);
					if (writtenIndexes.length === 1 && sameProvider(savedProvider, writtenSnapshot)) {
						const currentWrittenIndex = writtenIndexes[0]!;
						const targetIndexes = previousTarget
							? currentProviders.flatMap((provider, index) =>
									provider === previousTarget ? [index] : []
								)
							: [];
						if (previousTarget && targetIndexes.length === 0) {
							currentProviders[currentWrittenIndex] = previousTarget;
						} else {
							currentProviders.splice(currentWrittenIndex, 1);
						}
						restoredProvider = true;
					}
					if (
						restoredProvider &&
						previousSelectedProvider !== nextSelectedProvider &&
						this.plugin.settings.selectedProvider === nextSelectedProvider
					) {
						const restoredTargetIsUnique =
							!previousTarget ||
							currentProviders.filter((provider) => provider.name === previousTarget.name)
								.length === 1;
						const writtenNameStillExists = currentProviders.some(
							(provider) => provider.name === nextSelectedProvider
						);
						if (restoredTargetIsUnique && !writtenNameStillExists) {
							this.plugin.settings.selectedProvider = previousSelectedProvider;
						}
					}
					throw error;
				}
				if (!this.plugin.isActive()) return;
				saveType = 'edit';
				saveTarget = savedProvider;
				saveTargetBaseline = writtenSnapshot;
				this.onRefresh();
			},
			this.plugin.notices,
			providerToEdit
		);
		this.plugin.register(() => modal.close());
		modal.open();
	}
}
