import type { App } from 'obsidian';
import { ButtonComponent, Modal, Setting } from 'obsidian';

import { isDuplicateModel } from '../../../domain/model-list';
import { PROVIDER_NAMES, getProviderPresets } from '../../../utils/lib-utils';
import type { Model, ProviderConfig, ProviderPreset } from '../../../types';
import { ModalAccessibilityHelper } from '../components/ModalAccessibilityHelper';
import type { PluginNotices } from '../../plugin-notices';
import type { DropdownOption } from '../components/Setting';
import { Setting as CommonSetting } from '../components/Setting';

export interface ModelModalProps {
	providers: ProviderConfig[];
	onSave: (result: {
		provider: string;
		model: Model;
		isEdit: boolean;
		oldModel?: { model: string; provider: string };
	}) => void | Promise<void>;
	editTarget?: { model: string; name: string; provider: string; decision?: boolean };
	notices: PluginNotices;
}

export class ModelModal extends Modal {
	private props: ModelModalProps;
	private readonly accessibilityHelper = new ModalAccessibilityHelper();

	// Form state
	private selectedProvider: string = '';
	private modelName: string = '';
	private modelId: string = '';
	private decision = false;
	private idErrorEl: HTMLElement | null = null;

	constructor(app: App, props: ModelModalProps) {
		super(app);
		this.props = props;

		// Set initial values
		if (props.editTarget) {
			this.selectedProvider = props.editTarget.provider;
			this.modelName = props.editTarget.name;
			this.modelId = props.editTarget.model;
			this.decision = props.editTarget.decision === true;
		} else {
			// Set default provider for new models
			if (props.providers.length > 0) {
				this.selectedProvider = props.providers[0]!.name;
			}
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Accessibility: Set modal role and label
		contentEl.setAttribute('role', 'dialog');
		contentEl.setAttribute('aria-modal', 'true');
		const title = this.props.editTarget ? 'Edit model' : 'Add model';
		contentEl.setAttribute('aria-label', title);

		this.setTitle(title);

		// Provider selection
		this.addProviderSetting(contentEl);

		// Popular models section (only show for new models)
		if (!this.props.editTarget) {
			this.addPopularModelsSection(contentEl);
		}

		// Model form
		this.addModelForm(contentEl);

		// Buttons
		this.addButtons(contentEl);

		// Accessibility: Focus first input and setup keyboard navigation
		this.setupAccessibility(contentEl);
	}

	private setupAccessibility(contentEl: HTMLElement): void {
		this.accessibilityHelper.setup(contentEl);
	}

	private addProviderSetting(containerEl: HTMLElement): void {
		const providerOptions: DropdownOption[] = this.props.providers.map((provider) => ({
			value: provider.name,
			display: provider.name,
		}));

		CommonSetting.create(containerEl, {
			name: 'Provider',
			desc: 'Select the provider for this model.',
			dropdown: {
				options: providerOptions,
				value: this.selectedProvider,
				onChange: (value) => {
					this.selectedProvider = value;
					this.updatePopularModels();
					this.renderDecisionToggle();
					this.updateDuplicateError();
				},
			},
		});
	}

	private addPopularModelsSection(containerEl: HTMLElement): void {
		const popularSection = containerEl.createDiv({ cls: 'popular-models-section' });
		new Setting(popularSection).setName('Popular models').setHeading();
		popularSection.createEl('p', {
			text: 'Choose from commonly used models or enter custom model details.',
			cls: 'setting-item-description',
		});

		this.renderPopularModels(popularSection);
	}

	private renderPopularModels(containerEl: HTMLElement): void {
		// Remove existing models container
		const existingContainer = containerEl.querySelector('.popular-models-container');
		if (existingContainer) {
			existingContainer.remove();
		}

		// Find the selected provider data using utils
		let providerData: ProviderPreset | null = null;
		if (this.selectedProvider) {
			const presets = getProviderPresets();
			providerData = presets.find((preset) => preset.name === this.selectedProvider) || null;
		}

		const modelsContainer = containerEl.createDiv({
			cls: 'popular-models-container mac-grid-container',
		});

		if (providerData && providerData.popularModels) {
			// Add popular models as radio buttons
			providerData.popularModels.forEach((model) => {
				const modelOption = modelsContainer.createEl('label', {
					cls: 'model-option mac-model-option',
				});

				const radio = modelOption.createEl('input', {
					type: 'radio',
					attr: { name: 'popular-model' },
				});
				radio.value = model.id;
				radio.addEventListener('change', () => {
					if (radio.checked) {
						this.modelName = model.name;
						this.modelId = model.id;
						this.decision = model.decision === true;
						this.updateFormInputs();
						this.renderDecisionToggle();
						this.updateRadioSelection();
					}
				});

				modelOption.createSpan({ text: model.name });
			});
		}

		// Add Custom option
		const customOption = modelsContainer.createEl('label', {
			cls: 'model-option custom-option mac-model-option',
		});

		const customRadio = customOption.createEl('input', {
			type: 'radio',
			attr: { name: 'popular-model' },
		});
		customRadio.value = 'custom';
		customRadio.checked = true; // Set Custom as default selection
		customRadio.addEventListener('change', () => {
			if (customRadio.checked) {
				this.modelName = '';
				this.modelId = '';
				this.updateFormInputs();
				this.updateRadioSelection();
			}
		});
		customOption.createSpan({ text: 'Custom model' });
		this.syncRadioWithInputs();
	}

	private updateRadioSelection(): void {
		const modelOptions = this.contentEl.querySelectorAll('.model-option');
		modelOptions.forEach((option) => {
			const radio = option.querySelector('input[type="radio"]') as HTMLInputElement;
			const label = option as HTMLElement;

			if (radio && radio.checked) {
				label.classList.add('selected');
			} else {
				label.classList.remove('selected');
			}
		});
	}

	private addModelForm(containerEl: HTMLElement): void {
		// Create form container with class for easy identification
		const formContainer = containerEl.createDiv({ cls: 'model-form-container' });

		// Display name
		CommonSetting.create(formContainer, {
			name: 'Display name',
			desc: 'The name of the model you want to display in the interface.',
			textInput: {
				placeholder: 'Enter display name',
				value: this.modelName,
				onChange: (value) => {
					this.modelName = value;
					// When user types, clear radio selection (switch to custom)
					this.syncRadioWithInputs();
				},
			},
		});

		// Model ID
		CommonSetting.create(formContainer, {
			name: 'Model ID',
			desc: 'The identifier of the model from your provider. Typically a short name without spaces.',
			textInput: {
				placeholder: 'Enter model ID',
				value: this.modelId,
				onChange: (value) => {
					this.modelId = value;
					// When user types, update radio selection
					this.syncRadioWithInputs();
					this.updateDuplicateError();
				},
			},
		});

		const idDesc = formContainer.querySelector('.setting-item:last-child .setting-item-description');
		this.idErrorEl =
			(idDesc as HTMLElement | null)?.createDiv({
				cls: 'mac-field-error',
				attr: { 'aria-live': 'polite' },
			}) ?? null;
		this.updateDuplicateError();
		formContainer.createDiv({ cls: 'mac-decision-toggle' });
		this.renderDecisionToggle();
	}

	private offersDecisionChoice(): boolean {
		const name = this.selectedProvider;
		return name === PROVIDER_NAMES.OPENAI || name === PROVIDER_NAMES.OPENROUTER || name === PROVIDER_NAMES.CUSTOM;
	}

	/** Only endpoints that offer both chat and decision models need the choice. */
	private renderDecisionToggle(): void {
		const container = this.contentEl.querySelector<HTMLElement>('.mac-decision-toggle');
		if (!container) return;
		container.empty();
		const name = this.selectedProvider;
		if (name === PROVIDER_NAMES.TYPESAFE) {
			CommonSetting.create(container, {
				name: 'Decision API',
				desc: 'TypeSafe models always answer through the decision API.',
			});
			return;
		}
		if (!this.offersDecisionChoice()) return;
		CommonSetting.create(container, {
			name: 'Decision API',
			desc: 'Score values through the native decision endpoint instead of chat structured output.',
			toggle: {
				value: this.decision,
				onChange: (value) => {
					this.decision = value;
				},
			},
		});
	}

	private updateDuplicateError(): boolean {
		const duplicate = isDuplicateModel(
			this.props.providers,
			this.selectedProvider,
			this.modelId.trim(),
			this.props.editTarget
		);
		this.idErrorEl?.setText(duplicate ? `${this.selectedProvider} already has this model.` : '');
		this.contentEl
			.querySelector('input[placeholder="Enter model ID"]')
			?.toggleAttribute('aria-invalid', duplicate);
		return duplicate;
	}

	/**
	 * Sync radio button selection with current input values
	 * If inputs match a popular model, select that radio; otherwise select "Custom"
	 */
	private syncRadioWithInputs(): void {
		const modelOptions = this.contentEl.querySelectorAll('.model-option');
		let matchFound = false;

		modelOptions.forEach((option) => {
			const radio = option.querySelector('input[type="radio"]') as HTMLInputElement;
			if (!radio) return;

			// Check if this radio's value matches current model ID
			if (radio.value !== 'custom' && radio.value === this.modelId) {
				radio.checked = true;
				matchFound = true;
			} else if (radio.value === 'custom' && !matchFound) {
				// Will be set after loop if no match found
			} else {
				radio.checked = false;
			}
		});

		// If no popular model matched, select "Custom"
		if (!matchFound) {
			const customRadio = this.contentEl.querySelector(
				'.custom-option input[type="radio"]'
			) as HTMLInputElement;
			if (customRadio) {
				customRadio.checked = true;
			}
		}

		this.updateRadioSelection();
	}

	private updateFormInputs(): void {
		// Find and update input fields instead of re-rendering entire modal
		const formContainer = this.contentEl.querySelector('.model-form-container');
		if (!formContainer) return;

		// Update display name input
		const displayNameInput = formContainer.querySelector(
			'input[placeholder="Enter display name"]'
		) as HTMLInputElement;
		if (displayNameInput) {
			displayNameInput.value = this.modelName;
		}

		// Update model ID input
		const modelIdInput = formContainer.querySelector(
			'input[placeholder="Enter model ID"]'
		) as HTMLInputElement;
		if (modelIdInput) {
			modelIdInput.value = this.modelId;
		}
		this.updateDuplicateError();
	}

	private addButtons(containerEl: HTMLElement): void {
		const buttonContainer = containerEl.createDiv({ cls: 'button-container mac-button-container' });

		new ButtonComponent(buttonContainer).setButtonText('Cancel').onClick(() => this.close());

		new ButtonComponent(buttonContainer)
			.setButtonText('Save')
			.setCta()
			.onClick(() => {
				if (!this.validateForm()) return;
				const model: Model = {
					id: this.modelId,
					name: this.modelName,
					...(this.decision && this.offersDecisionChoice() && { decision: true }),
				};

				// Use callback to handle business logic
				void this.props.onSave({
					provider: this.selectedProvider,
					model: model,
					isEdit: !!this.props.editTarget,
					oldModel: this.props.editTarget
						? {
								model: this.props.editTarget.model,
								provider: this.props.editTarget.provider,
							}
						: undefined,
				});
				this.close();
			});
	}

	private updatePopularModels(): void {
		const popularSection = this.contentEl.querySelector('.popular-models-section');
		if (popularSection) {
			this.renderPopularModels(popularSection as HTMLElement);
		}
	}

	private validateForm(): boolean {
		if (!this.selectedProvider) {
			this.props.notices.show('validation_error', {
				component: 'Model',
				message: 'Select a provider.',
			});
			return false;
		}

		if (!this.modelId.trim()) {
			this.props.notices.show('validation_error', {
				component: 'Model',
				message: 'Enter a model ID.',
			});
			return false;
		}

		if (!this.modelName.trim()) {
			this.props.notices.show('validation_error', {
				component: 'Model',
				message: 'Enter a display name.',
			});
			return false;
		}

		if (this.updateDuplicateError()) {
			// Re-announce the inline error on every blocked Save.
			this.contentEl.querySelector<HTMLInputElement>('input[placeholder="Enter model ID"]')?.focus();
			this.idErrorEl?.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
			return false;
		}

		return true;
	}

	onClose(): void {
		const { contentEl } = this;
		this.accessibilityHelper.cleanup(contentEl);
		contentEl.empty();
	}
}
