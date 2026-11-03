import type AutoClassifierPlugin from '../../main';
import { PluginSettingTab, Setting as ObsidianSetting, SettingGroup } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';

import type { FrontmatterField } from '../../types';
import { DEFAULT_FRONTMATTER_SETTING } from '../../domain/constants';
import { generateId } from '../../utils/lib-utils';
import { Api } from './ApiSection';
import { Frontmatter } from './FrontmatterSection';
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

	getSettingDefinitions(): SettingDefinitionItem[] {
		const mount = (render: (el: HTMLElement) => void) => (setting: ObsidianSetting) => {
			setting.settingEl.empty();
			render(setting.settingEl.createDiv({ cls: 'mac-setting-mount' }));
		};
		return [
			{ name: 'Classification', aliases: ['API', 'provider', 'model', 'decision'], render: mount((el) => this.renderApi(el)) },
			{ name: 'Frontmatters', aliases: ['tags'], render: mount((el) => this.renderFrontmatters(el)) },
			{
				name: 'Hidden notices',
				aliases: ['muted', 'notifications'],
				// Definitions are read once and Obsidian redraws the entry, so emptiness is a class set on each render.
				render: (setting) => {
					const isEmpty = this.plugin.notices.listMuted().length === 0;
					setting.settingEl.toggleClass('mac-setting-empty', isEmpty);
					if (!isEmpty) mount((el) => this.renderNotices(el))(setting);
				},
			},
			{ name: 'Support Auto Classifier', render: mount((el) => this.renderSupport(el)) },
		];
	}

	private renderApi(containerEl: HTMLElement): void {
		this.api = new Api(this.plugin, containerEl.createDiv({ cls: 'api-section' }));
		this.api.display();
	}

	private renderFrontmatters(containerEl: HTMLElement): void {
		const { listEl } = new SettingGroup(containerEl)
			.setHeading('Frontmatters')
			.addExtraButton((button) =>
				button
					.setIcon('plus')
					.setTooltip('Add frontmatter')
					.onClick(() => this.addNewFrontmatter())
			);
		this.tagSetting = new Tag(this.plugin, listEl);
		this.tagSetting.display();
		this.frontmatterSetting = new Frontmatter(this.plugin, new SettingGroup(containerEl).listEl);
		this.frontmatterSetting.display();
	}

	/** Only shown while something is hidden: with nothing muted there is nothing to read or do here. */
	private renderNotices(containerEl: HTMLElement): void {
		const { notices } = this.plugin;
		const count = notices.listMuted().length;
		if (count === 0) return;
		const setting = new ObsidianSetting(containerEl)
			.setName('Hidden notices')
			.setDesc(
				count === 1
					? '1 notice you muted will not appear.'
					: `${count} notices you muted will not appear.`
			);
		setting.addButton((btn) => {
			btn.setButtonText('Show again').onClick(async () => {
				if (!this.plugin.isActive()) return;
				try {
					await notices.unmuteAll();
					if (!this.plugin.isActive()) return;
					const entryEl = containerEl.closest('.setting-item');
					if (entryEl) entryEl.addClass('mac-setting-empty');
					else setting.settingEl.remove();
					notices.show('notices_restored');
				} catch {
					if (this.plugin.isActive()) notices.show('validation_error', { message: 'Could not show muted notices again.' });
				}
			});
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
		const newFrontmatter: FrontmatterField = {
			id: generateId(),
			...structuredClone(DEFAULT_FRONTMATTER_SETTING),
		};
		this.plugin.settings.frontmatter.push(newFrontmatter);
		void this.plugin.saveSettings();
		this.frontmatterSetting.display();
	}
}
