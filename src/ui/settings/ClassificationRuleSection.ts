import { TextAreaComponent } from 'obsidian';

import { DEFAULT_TASK_TEMPLATE } from '../../domain/constants';
import type AutoClassifierPlugin from '../../main';
import { Setting } from './components/Setting';

export class ClassificationRuleSection {
	constructor(
		private readonly plugin: AutoClassifierPlugin,
		private readonly onRefresh: () => void
	) {}

	render(containerEl: HTMLElement, classificationRule: string): void {
		const textAreaContainer = containerEl.createDiv({
			cls: 'custom-prompt-container mac-custom-prompt-container',
		});

		// Using let because textAreaComponent is referenced in onClick closure before assignment
		let textAreaComponent: TextAreaComponent;

		Setting.create(textAreaContainer, {
			name: 'Classification Rule',
			desc: 'Customize the prompt template for classification requests',
			button: {
				icon: 'reset',
				tooltip: 'Reset to default template',
				onClick: () => {
					textAreaComponent.setValue(DEFAULT_TASK_TEMPLATE);
					this.plugin.settings.classificationRule = DEFAULT_TASK_TEMPLATE;
					void this.plugin.saveSettings();
					this.onRefresh();
				},
			},
		});

		textAreaComponent = new TextAreaComponent(textAreaContainer)
			.setPlaceholder(DEFAULT_TASK_TEMPLATE)
			.setValue(classificationRule)
			.onChange(async (value) => {
				this.plugin.settings.classificationRule = value;
				await this.plugin.saveSettings();
			});

		textAreaComponent.inputEl.rows = 10;
		textAreaComponent.inputEl.addClass('mac-classification-rule-textarea');
	}
}
