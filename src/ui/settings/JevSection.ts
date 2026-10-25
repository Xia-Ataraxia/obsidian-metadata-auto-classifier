import { Setting as ObsidianSetting } from 'obsidian';

import type AutoClassifierPlugin from '../../main';

export class JevSection {
	constructor(
		private readonly plugin: AutoClassifierPlugin,
		private readonly containerEl: HTMLElement
	) {}

	display(): void {
		this.containerEl.empty();

		new ObsidianSetting(this.containerEl)
			.setName('Jev classification')
			.setDesc('Jev handles classification for all candidates.')
			.setHeading();

		new ObsidianSetting(this.containerEl).setName('Jev API key').addText((text) => {
			text.inputEl.type = 'password';
			text.setPlaceholder('Enter an API key');
			text.setValue(this.plugin.settings.jev.apiKey);
			text.onChange(async (apiKey) => {
				this.plugin.settings.jev.apiKey = apiKey;
				await this.plugin.saveSettings();
			});
		});

		new ObsidianSetting(this.containerEl).setName('Jev model').addText((text) => {
			text.setPlaceholder('Enter a versioned model');
			text.setValue(this.plugin.settings.jev.model);
			text.onChange(async (model) => {
				this.plugin.settings.jev.model = model;
				await this.plugin.saveSettings();
			});
		});
	}
}
