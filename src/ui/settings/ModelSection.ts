import { confirmAction } from './modals/ConfirmModal';
import { Setting as ObsidianSetting, type App } from 'obsidian';

import type AutoClassifierPlugin from '../../main';
import { testModel } from '../provider-api';
import { toApiErrorNotice } from '../../utils/api-error-notice';
import type { Model, ProviderConfig } from '../../types';
import { ClassificationStateError } from '../../domain/classification-state';
import { findUniqueProvider, getProviderPresets } from '../../utils/lib-utils';
import { createProviderSession } from '../provider-session';
import { Setting } from './components/Setting';
import { ModelModal, type ModelModalProps } from './modals/ModelModal';

const MODEL_TEST_TIMEOUT_MS = 60_000;

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
								if (!this.plugin.isActive()) return;
								const liveProvider = findUniqueProvider(
									this.plugin.settings.providers,
									provider.name
								);
								if (
									liveProvider !== provider ||
									provider.models.filter((model) => model.id === config.id).length !== 1 ||
									provider.models.find((model) => model.id === config.id) !== config
								)
									return;
								this.plugin.settings.selectedProvider = provider.name;
								this.plugin.settings.selectedModel = config.id;
								await this.plugin.saveSettings();
								if (!this.plugin.isActive()) return;
								this.onRefresh();
							},
						},
						{
							icon: 'plug-zap',
							text: 'Test',
							busyText: 'Testing…',
							onClick: async () => {
								try {
									const providerName = provider.name;
									const modelId = config.id;
									const assertModelCurrent = (): void => {
										if (!this.plugin.isActive()) {
											throw new ClassificationStateError('operation-revoked');
										}
										const liveProvider = findUniqueProvider(
											this.plugin.settings.providers,
											providerName
										);
										if (
											!liveProvider ||
											liveProvider !== provider ||
											!liveProvider.models.some((item) => item.id === modelId)
										) {
											throw new ClassificationStateError('provider-changed');
										}
									};
									const session = createProviderSession({
										getProvider: () => {
											const uniqueProvider = findUniqueProvider(
												this.plugin.settings.providers,
												providerName
											);
											return uniqueProvider === provider ? uniqueProvider : undefined;
										},
										saveSettings: () => this.plugin.saveSettings(),
										assertCurrent: assertModelCurrent,
									});
									const success = await testModel(
										session.provider,
										modelId,
										session.refreshTokens,
										{
											deadline: Date.now() + MODEL_TEST_TIMEOUT_MS,
											assertCurrent: session.assertCurrent,
										}
									);
									session.assertCurrent();
									if (success) {
										this.plugin.notices.show('model_test_success', { name: config.name });
									} else {
										if (!this.plugin.isActive()) return;
										this.plugin.notices.show('model_test_failed', { name: config.name });
									}
								} catch (error) {
									if (!this.plugin.isActive() || error instanceof ClassificationStateError) return;
									const safeProviderName = getProviderPresets().some(
										(preset) => preset.name === provider.name
									)
										? provider.name
										: 'provider';
									this.plugin.notices.show('model_test_error', {
										name: config.name,
										message: toApiErrorNotice(error, safeProviderName),
									});
								}
							},
						},
						{
							icon: 'pencil',
							text: 'Edit',
							onClick: () => {
								if (!this.plugin.isActive()) return;
								this.openModelModal('edit', editTarget, provider, config);
							},
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

								const providers = this.plugin.settings.providers;
								if (
									!this.plugin.isActive() ||
									findUniqueProvider(providers, provider.name) !== provider ||
									providers.filter((item) => item === provider).length !== 1 ||
									provider.models.filter((model) => model.id === config.id).length !== 1 ||
									provider.models.find((model) => model.id === config.id) !== config
								)
									return;

								provider.models = provider.models.filter((model: Model) => model.id !== config.id);

								if (
									findUniqueProvider(providers, this.plugin.settings.selectedProvider) ===
										provider &&
									this.plugin.settings.selectedModel === config.id
								) {
									this.plugin.settings.selectedProvider = '';
									this.plugin.settings.selectedModel = '';
								}

								await this.plugin.saveSettings();
								if (!this.plugin.isActive()) return;
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
		editTarget?: { model: string; name: string; provider: string },
		capturedSource?: ProviderConfig,
		capturedModel?: Model
	): void {
		if (!this.plugin.isActive()) return;
		const modalProviders = [...this.plugin.settings.providers];
		const modalProps: ModelModalProps = {
			providers: modalProviders,
			notices: this.plugin.notices,
			onSave: async (result) => {
				if (!this.plugin.isActive()) return;
				const currentProviders = this.plugin.settings.providers;
				const openedTarget = findUniqueProvider(modalProviders, result.provider);
				const target = findUniqueProvider(currentProviders, result.provider);
				if (!openedTarget || target !== openedTarget) return;

				if (type === 'edit') {
					const oldModel = result.oldModel;
					if (
						!result.isEdit ||
						!oldModel ||
						!editTarget ||
						!capturedSource ||
						!capturedModel ||
						oldModel.provider !== editTarget.provider ||
						oldModel.model !== editTarget.model
					)
						return;

					const openedSource = findUniqueProvider(modalProviders, oldModel.provider);
					const source = findUniqueProvider(currentProviders, oldModel.provider);
					if (
						openedSource !== capturedSource ||
						source !== capturedSource ||
						capturedSource.models.filter((model) => model.id === oldModel.model).length !== 1 ||
						capturedSource.models.find((model) => model.id === oldModel.model) !== capturedModel ||
						capturedSource.models.find((model) => model.id === oldModel.model)?.name !==
							editTarget.name
					)
						return;

					const selectionOwnedByOldModel =
						this.plugin.settings.selectedProvider === oldModel.provider &&
						this.plugin.settings.selectedModel === oldModel.model;
					capturedSource.models = capturedSource.models.filter(
						(model) => model.id !== oldModel.model
					);
					target.models.push(result.model);
					if (selectionOwnedByOldModel) {
						this.plugin.settings.selectedProvider = result.provider;
						this.plugin.settings.selectedModel = result.model.id;
					}
				} else {
					if (result.isEdit) return;
					target.models.push(result.model);
				}

				await this.plugin.saveSettings();
				if (!this.plugin.isActive()) return;
				this.onRefresh();
			},
			editTarget: editTarget,
		};

		const modal = new ModelModal(this.app, modalProps);
		this.plugin.register(() => modal.close());
		modal.open();
	}
}
