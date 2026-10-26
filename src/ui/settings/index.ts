import type AutoClassifierPlugin from '../../main';
import { PluginSettingTab, Setting as ObsidianSetting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';

import type { FrontmatterField } from '../../types';
import { generateId } from '../../utils/lib-utils';
import { DEFAULT_FRONTMATTER_SETTING } from '../../domain/constants';
import { Setting } from './components/Setting';
import { Api } from './ApiSection';
import { Frontmatter } from './FrontmatterSection';
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

		this.apiContainer = createDiv();
		this.tagContainer = createDiv();
		this.frontmatterContainer = createDiv();

		this.api = new Api(plugin, this.apiContainer);
		this.tagSetting = new Tag(plugin, this.tagContainer);
		this.frontmatterSetting = new Frontmatter(plugin, this.frontmatterContainer);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderApi(containerEl);
		this.renderFrontmatters(containerEl);
		this.renderNotices(containerEl);
		this.renderSupport(containerEl);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const mount = (render: (el: HTMLElement) => void) => (setting: ObsidianSetting) => {
			setting.settingEl.empty();
			render(setting.settingEl.createDiv({ cls: 'mac-setting-mount' }));
		};
		return [
			{ name: 'API configuration', aliases: ['provider', 'model'], render: mount((el) => this.renderApi(el)) },
			{ name: 'Frontmatters', aliases: ['tags'], render: mount((el) => this.renderFrontmatters(el)) },
			{ name: 'Muted notices', aliases: ['notifications'], render: mount((el) => this.renderNotices(el)) },
			{ name: 'Support Auto Classifier', render: mount((el) => this.renderSupport(el)) },
		];
	}

	private renderSupport(containerEl: HTMLElement): void {
		Setting.create(containerEl, {
			name: 'Support Auto Classifier',
			desc: 'If Auto Classifier saves you time, consider supporting its development.',
			heading: true,
			className: 'auto-classifier-settings-support',
			button: {
				text: 'Buy me a coffee',
				cta: true,
				onClick: () => {
					window.open('https://www.buymeacoffee.com/gobeumsu9', '_blank');
				},
			},
		});
	}

	private renderApi(containerEl: HTMLElement): void {
		this.apiContainer = containerEl.createDiv({ cls: 'api-section' });
		this.api = new Api(this.plugin, this.apiContainer);
		this.api.display();
	}

	private renderFrontmatters(containerEl: HTMLElement): void {
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

	private renderNotices(containerEl: HTMLElement): void {
		const { notices } = this.plugin;
		const setting = new ObsidianSetting(containerEl).setName('Muted notices');
		setting.descEl.addClass('mac-muted-count');
		setting.addButton((btn) => {
			const refresh = () => {
				const count = notices.listMuted().length;
				setting.setDesc(count > 0 ? `${count} muted` : 'None muted');
				btn.setDisabled(count === 0);
			};
			btn.setButtonText('Reset').onClick(async () => {
				await notices.unmuteAll();
				refresh();
			});
			refresh();
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

export type { AutoClassifierSettings } from '../../types';
export * from './components/WikiLinkSelector';
export * from './modals/FrontmatterEditorModal';
export * from './modals/FrontmatterSelectModal';
