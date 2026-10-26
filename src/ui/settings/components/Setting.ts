import {
	ExtraButtonComponent,
	Setting as ObsidianSetting,
	TextAreaComponent,
} from 'obsidian';

export interface ButtonProps {
	text?: string;
	icon?: string;
	tooltip?: string;
	onClick: () => void | Promise<void>;
	cta?: boolean;
	warning?: boolean;
	disabled?: boolean;
	/** Label shown while an async onClick runs; the button spins and is disabled. */
	busyText?: string;
}

export interface DropdownOption {
	value: string;
	display: string;
}

export interface TextInputConfig {
	placeholder?: string;
	value?: string;
	disabled?: boolean;
	password?: boolean;
	onChange: (value: string) => void | Promise<void>;
}

export interface DropdownConfig {
	options: DropdownOption[];
	value?: string;
	onChange: (value: string) => void | Promise<void>;
}

export interface ToggleConfig {
	value: boolean;
	onChange: (value: boolean) => void | Promise<void>;
}

export interface TextAreaConfig {
	placeholder?: string;
	value?: string;
	rows?: number;
	onChange: (value: string) => void | Promise<void>;
}

export interface SettingProps {
	name: string;
	desc?: string;
	className?: string;
	heading?: boolean;

	// Input components
	textInput?: TextInputConfig;
	dropdown?: DropdownConfig;
	toggle?: ToggleConfig;
	textArea?: TextAreaConfig;

	// Button components
	button?: ButtonProps;
	extraButton?: ButtonProps;
	buttons?: ButtonProps[];
}

export class Setting {
	private setting: ObsidianSetting;

	constructor(containerEl: HTMLElement, props: SettingProps) {
		const {
			name,
			desc,
			className,
			heading,
			textInput,
			dropdown,
			toggle,
			textArea,
			button,
			extraButton,
			buttons,
		} = props;

		this.setting = new ObsidianSetting(containerEl);
		this.setting.setName(name);

		if (desc) this.setting.setDesc(desc);
		if (heading) this.setting.setHeading();

		if (className) this.setting.settingEl.addClass(className);

		// Initialize components based on configuration
		if (textInput) this.initTextInput(textInput);
		if (dropdown) this.initDropdown(dropdown);
		if (toggle) this.initToggle(toggle);
		if (textArea) this.initTextArea(textArea);

		if (button) this.addButton(button);
		if (extraButton) this.addExtraButton(extraButton);
		if (buttons) {
			buttons.forEach((buttonProps) => {
				if (buttonProps.text) {
					this.addButton(buttonProps);
				} else {
					this.addExtraButton(buttonProps);
				}
			});
		}
	}

	/**
	 * Static factory method for creating settings with side effects.
	 * This method clearly indicates that it performs DOM manipulation and returns void.
	 */
	public static create(containerEl: HTMLElement, props: SettingProps): void {
		new Setting(containerEl, props);
	}

	private initTextInput(textInput: TextInputConfig): void {
		this.setting.addText((text) => {
			if (textInput.placeholder) text.setPlaceholder(textInput.placeholder);
			if (textInput.value !== undefined) text.setValue(textInput.value);
			if (textInput.password) text.inputEl.type = 'password';
			if (textInput.disabled) {
				text.inputEl.disabled = true;
				text.inputEl.classList.add('mod-disabled');
			}
			text.onChange(textInput.onChange);
		});
	}

	private initDropdown(config: DropdownConfig): void {
		this.setting.addDropdown((component) => {
			config.options.forEach(({ value, display }) => {
				component.addOption(value, display);
			});
			component.setValue(config.value ?? '');
			component.onChange(config.onChange);
		});
	}

	private initToggle(toggle: ToggleConfig): void {
		this.setting.addToggle((component) => {
			component.setValue(toggle.value);
			component.onChange(toggle.onChange);
		});
	}

	private initTextArea(textArea: TextAreaConfig): void {
		const textareaContainer = this.setting.settingEl.createDiv({ cls: 'textarea-container' });
		const component = new TextAreaComponent(textareaContainer);

		if (textArea.placeholder) component.setPlaceholder(textArea.placeholder);
		if (textArea.value !== undefined) component.setValue(textArea.value);
		if (textArea.rows) component.inputEl.rows = textArea.rows;
		component.onChange(textArea.onChange);
	}

	private addButton(props: ButtonProps): void {
		this.setting.addButton((btn) => {
			if (props.text) btn.setButtonText(props.text);
			if (props.icon) btn.setIcon(props.icon);
			// setIcon replaces the button text, so keep it as the accessible label
			const tooltip = props.tooltip ?? (props.icon ? props.text : undefined);
			if (tooltip) btn.setTooltip(tooltip);
			if (props.cta) btn.setCta();
			if (props.warning) btn.buttonEl.addClass('mod-warning');
			if (props.disabled) btn.setDisabled(props.disabled);
			const { busyText } = props;
			if (!busyText) {
				btn.onClick(props.onClick);
				return;
			}
			// Obsidian shows its own spinner (mod-loading) while an async onClick runs; only the label changes.
			btn.onClick(async () => {
				btn.setTooltip(busyText);
				try {
					await props.onClick();
				} finally {
					btn.setTooltip(tooltip ?? '');
				}
			});
		});
	}

	private addExtraButton(props: ButtonProps): void {
		this.setting.addExtraButton((btn: ExtraButtonComponent) => {
			if (props.icon) btn.setIcon(props.icon);
			if (props.tooltip) btn.setTooltip(props.tooltip);
			if (props.disabled) btn.setDisabled(props.disabled);
			btn.onClick(props.onClick);
		});
	}
}
