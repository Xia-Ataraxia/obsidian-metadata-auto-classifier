import { App } from 'obsidian';

import type AutoClassifierPlugin from '../../main';
import { ClassificationRuleSection } from './ClassificationRuleSection';
import { ModelSection } from './ModelSection';
import { ProviderSection } from './ProviderSection';

export class Api {
	private readonly app: App;
	private readonly providerSection: ProviderSection;
	private readonly modelSection: ModelSection;
	private readonly classificationRuleSection: ClassificationRuleSection;

	constructor(
		private readonly plugin: AutoClassifierPlugin,
		private readonly containerEl: HTMLElement
	) {
		this.app = plugin.app;
		const onRefresh = () => this.display();

		this.providerSection = new ProviderSection(plugin, this.app, onRefresh);
		this.modelSection = new ModelSection(plugin, this.app, onRefresh);
		this.classificationRuleSection = new ClassificationRuleSection(plugin, onRefresh);
	}

	display(): void {
		const { classificationRule, providers, selectedModel } = this.plugin.settings;
		this.containerEl.empty();
		this.classificationRuleSection.render(this.containerEl, classificationRule);

		this.containerEl.createEl('h2', {
			text: 'Optional provider for explicitly enabled new-tag generation',
		});

		this.providerSection.render(this.containerEl, providers);
		this.modelSection.render(this.containerEl, providers, selectedModel);
	}
}
