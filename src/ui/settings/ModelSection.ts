import { confirmAction } from './modals/ConfirmModal';
import { Setting as ObsidianSetting, type App } from 'obsidian';

import type AutoClassifierPlugin from '../../main';
import { testModel } from '../provider-api';
import { saveModel } from '../../domain/model-list';
import { toApiErrorNotice } from '../../utils/api-error-notice';
import type { Model, ProviderConfig } from '../../types';
import { Setting } from './components/Setting';
import { ModelModal, type ModelModalProps } from './modals/ModelModal';

export class ModelSection {
	constructor(
		private readonly plugin: AutoClassifierPlugin,
		private readonly app: App,
		private readonly onRefresh: () => void
	) {}

	render(containerEl: HTMLElement, providers: ProviderConfig[], selectedModel: string): void {
		const modelSection = containerEl.createDiv({ cls: 'model-section' });
		new ObsidianSetting(modelSection).setName('Models').setHeading();

		this.renderModelList(modelSection, providers, selectedModel);

		Setting.create(modelSection, {
			name: '',
			button: {
				text: '+ Add model',
				onClick: () => this.openModelModal('add'),
			},
		});
	}

	private renderModelList(
		containerEl: HTMLElement,
		providers: ProviderConfig[],
		selectedModel: string
	): void {
		const hasModels = providers.some((p) => p.models.length > 0);

		if (!hasModels) {
			Setting.create(containerEl, {
				name: 'No models configured',
				desc: 'Add a model to get started.',
			});
			return;
		}

		providers.forEach((provider) => {
			provider.models.forEach((config: Model) => {
				const isActive =
					selectedModel === config.id && this.plugin.settings.selectedProvider === provider.name;
				const editTarget = {
					model: config.id,
					name: config.name,
					provider: provider.name,
				};

				Setting.create(containerEl, {
					name: config.name,
					desc: provider.name,
					buttons: [
						{
							icon: 'check',
							text: isActive ? 'Selected' : 'Select',
							cta: isActive,
							onClick: async () => {
								this.plugin.settings.selectedProvider = provider.name;
								this.plugin.settings.selectedModel = config.id;
								await this.plugin.saveSettings();
								this.onRefresh();
							},
						},
						{
							icon: 'plug-zap',
							text: 'Test',
							busyText: 'Testing…',
							onClick: async () => {
								try {
									await testModel(provider, config.id);
									this.plugin.notices.show('model_test_success', { name: config.name });
								} catch (error) {
									console.error(`[MAC] ${config.name} test failed:`, error);
									this.plugin.notices.show('model_test_error', {
										name: config.name,
										message: toApiErrorNotice(error, provider.name),
									});
								}
							},
						},
						{
							icon: 'pencil',
							text: 'Edit',
							onClick: () => this.openModelModal('edit', editTarget),
						},
						{
							icon: 'trash',
							text: 'Delete',
							onClick: async () => {
								const confirmed = await confirmAction(
									this.app,
									`Delete "${config.name}"?`,
									'Delete'
								);
								if (!confirmed) return;

								const currentProvider = this.plugin.settings.providers.find(
									(p) => p.name === provider.name
								);
								if (currentProvider) {
									currentProvider.models = currentProvider.models.filter(
										(m: Model) => m.id !== config.id
									);
								}

								if (this.plugin.settings.selectedModel === config.id) {
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
		});
	}

	private openModelModal(
		type: 'add' | 'edit',
		editTarget?: { model: string; name: string; provider: string }
	): void {
		const modalProps: ModelModalProps = {
			providers: this.plugin.settings.providers,
			notices: this.plugin.notices,
			onSave: async (result) => {
				saveModel(
					this.plugin.settings.providers,
					this.plugin.settings,
					result.provider,
					result.model,
					result.oldModel
				);

				await this.plugin.saveSettings();
				this.onRefresh();
			},
			editTarget: editTarget,
		};

		const modal = new ModelModal(this.app, modalProps);
		modal.open();
	}
}
