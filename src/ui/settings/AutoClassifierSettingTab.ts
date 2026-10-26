import type AutoClassifierPlugin from '../../main';
import { PluginSettingTab, Setting as ObsidianSetting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';

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
	api!: Api;
	tagSetting!: Tag;
	frontmatterSetting!: Frontmatter;

	constructor(plugin: AutoClassifierPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderJev(containerEl);
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
			{ name: 'Jev classification', aliases: ['selection', 'candidates'], render: mount((el) => this.renderJev(el)) },
			{ name: 'Tag generation', aliases: ['API', 'provider', 'model'], render: mount((el) => this.renderApi(el)) },
			{ name: 'Frontmatters', aliases: ['tags'], render: mount((el) => this.renderFrontmatters(el)) },
			{ name: 'Muted notices', aliases: ['notifications'], render: mount((el) => this.renderNotices(el)) },
			{ name: 'Support Auto Classifier', render: mount((el) => this.renderSupport(el)) },
		];
	}

	private renderJev(containerEl: HTMLElement): void {
		new JevSection(this.plugin, containerEl.createDiv({ cls: 'jev-section' })).display();
	}

	private renderApi(containerEl: HTMLElement): void {
		this.api = new Api(this.plugin, containerEl.createDiv({ cls: 'api-section' }));
		this.api.display();
	}

	private renderFrontmatters(containerEl: HTMLElement): void {
		new ObsidianSetting(containerEl).setName('Frontmatters').setHeading();
		this.tagSetting = new Tag(this.plugin, containerEl.createDiv({ cls: 'tag-section' }));
		this.tagSetting.display();
		this.frontmatterSetting = new Frontmatter(this.plugin, containerEl.createDiv({ cls: 'frontmatter-section' }));
		this.frontmatterSetting.display();
		Setting.create(containerEl.createDiv({ cls: 'add-button-container' }), {
			name: '',
			button: { text: '+ Add frontmatter', onClick: () => this.addNewFrontmatter() },
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
				if (!this.plugin.isActive()) return;
				try {
					await notices.unmuteAll();
					if (this.plugin.isActive()) refresh();
				} catch {
					if (this.plugin.isActive()) notices.show('validation_error', { message: 'Could not reset muted notices.' });
				}
			});
			refresh();
		});
	}

	private renderSupport(containerEl: HTMLElement): void {
		Setting.create(containerEl, {
			name: 'Support Auto Classifier',
			desc: 'If Auto Classifier saves you time, consider supporting its development.',
			className: 'auto-classifier-settings-support',
			button: {
				text: 'Buy me a coffee',
				cta: true,
				onClick: () => { window.open('https://www.buymeacoffee.com/gobeumsu9', '_blank'); },
			},
		});
	}

	private addNewFrontmatter(): void {
		const newFrontmatter: FrontmatterField = { id: generateId(), ...DEFAULT_FRONTMATTER_SETTING };
		this.plugin.settings.frontmatter.push(newFrontmatter);
		void this.plugin.saveSettings();
		this.frontmatterSetting.display();
	}
}
