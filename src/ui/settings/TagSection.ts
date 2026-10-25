import type { FrontmatterActions, FrontmatterField, SettingsComponentOptions } from '../../types';
import { BaseSettingsComponent } from './components/BaseSettings';

export class Tag extends BaseSettingsComponent {
	protected readonly options: SettingsComponentOptions = {
		showLinkType: false,
		showOptions: false,
		showTextArea: false,
	};

	display(): void {
		this.containerEl.empty();

		const tagSetting = this.plugin.settings.frontmatter.find((f) => f.id === 0);
		if (!tagSetting) {
			return;
		}

		const actions: FrontmatterActions = {
			onEdit: (setting: FrontmatterField) => this.handleEdit(setting),
			onDelete: () => {},
		};

		this.createFrontmatterSetting(this.containerEl, tagSetting, actions, false);
	}

	private handleEdit(frontmatterSetting: FrontmatterField): void {
		this.openEditModal(frontmatterSetting, async (updatedFrontmatter) => {
			updatedFrontmatter.generateNewTags =
				updatedFrontmatter.name === 'tags' && updatedFrontmatter.generateNewTags === true;
			const tagSettingIndex = this.plugin.settings.frontmatter.findIndex((f) => f.id === 0);
			if (tagSettingIndex !== -1) {
				this.plugin.settings.frontmatter[tagSettingIndex] = updatedFrontmatter;
			}

			await this.plugin.saveSettings();
			this.display();
		});
	}
}
