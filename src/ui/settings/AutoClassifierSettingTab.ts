import type AutoClassifierPlugin from '../../main';
import { PluginSettingTab, Setting as ObsidianSetting } from 'obsidian';

import type { FrontmatterField } from '../../types';
import { DEFAULT_FRONTMATTER_SETTING } from '../../domain/constants';
import { generateId } from '../../utils/lib-utils';
import { Api } from './ApiSection';
import { Frontmatter } from './FrontmatterSection';
import { JevSection } from './JevSection';
import { Setting } from './components/Setting';
import { Tag } from './TagSection';

export class AutoClassifierSettingTab extends PluginSettingTab {
	plugin: AutoClassifierPlugin;
	api: Api;
	tagSetting: Tag;
	frontmatterSetting: Frontmatter;

	private apiContainer: HTMLElement;
	private tagContainer: HTMLElement;
	private frontmatterContainer: HTMLElement;

	constructor(plugin: AutoClassifierPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;

		this.apiContainer = document.createElement('div');
		this.tagContainer = document.createElement('div');
		this.frontmatterContainer = document.createElement('div');

		this.api = new Api(plugin, this.apiContainer);
		this.tagSetting = new Tag(plugin, this.tagContainer);
		this.frontmatterSetting = new Frontmatter(plugin, this.frontmatterContainer);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		Setting.create(containerEl, {
			name: 'Support Auto Classifier',
			desc: 'If you find Auto Classifier valuable, consider supporting its development!',
			heading: true,
			className: 'auto-classifier-settings-support',
			button: {
				text: 'Buy Me a Coffee',
				cta: true,
				onClick: () => {
					window.open('https://www.buymeacoffee.com/gobeumsu9', '_blank');
				},
			},
		});

		const jevContainer = containerEl.createDiv({ cls: 'jev-section' });
		new JevSection(this.plugin, jevContainer).display();

		this.apiContainer = containerEl.createDiv({ cls: 'api-section' });
		this.api = new Api(this.plugin, this.apiContainer);
		this.api.display();

		new ObsidianSetting(containerEl).setName('Frontmatters').setHeading();

		this.tagContainer = containerEl.createDiv({ cls: 'tag-section' });
		this.tagSetting = new Tag(this.plugin, this.tagContainer);
		this.tagSetting.display();

		this.frontmatterContainer = containerEl.createDiv({ cls: 'frontmatter-section' });
		this.frontmatterSetting = new Frontmatter(this.plugin, this.frontmatterContainer);
		this.frontmatterSetting.display();

		const addButtonContainer = containerEl.createDiv({ cls: 'add-button-container' });
		Setting.create(addButtonContainer, {
			name: '',
			button: {
				text: '+ Add frontmatter',
				onClick: () => this.addNewFrontmatter(),
			},
		});
	}

	private addNewFrontmatter(): void {
		const newFrontmatter: FrontmatterField = {
			id: generateId(),
			...DEFAULT_FRONTMATTER_SETTING,
		};

		this.plugin.settings.frontmatter.push(newFrontmatter);
		void this.plugin.saveSettings();
		this.frontmatterSetting.display();
	}
}
