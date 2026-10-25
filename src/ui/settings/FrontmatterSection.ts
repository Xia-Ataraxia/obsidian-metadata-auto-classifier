import { confirmAction } from './modals/ConfirmModal';
import type { FrontmatterActions, FrontmatterField, SettingsComponentOptions } from '../../types';
import { BaseSettingsComponent } from './components/BaseSettings';

export class Frontmatter extends BaseSettingsComponent {
	protected readonly options: SettingsComponentOptions = {
		showLinkType: true,
		showOptions: true,
		showTextArea: true,
	};

	display(): void {
		const { frontmatter } = this.plugin.settings;
		const filteredFrontmatter = frontmatter.filter((frontmatter) => frontmatter.id !== 0);

		this.containerEl.empty();
		filteredFrontmatter.forEach((frontmatter: FrontmatterField) => {
			const actions: FrontmatterActions = {
				onEdit: (setting: FrontmatterField) => this.handleEdit(setting),
				onDelete: (setting: FrontmatterField) => void this.handleDelete(setting),
			};

			this.createFrontmatterSetting(this.containerEl, frontmatter, actions, true);
		});
	}

	private handleEdit(frontmatterSetting: FrontmatterField): void {
		this.openEditModal(frontmatterSetting, async (updatedFrontmatter) => {
			// The modal edits a clone, so write it back by id
			this.plugin.settings.frontmatter = this.plugin.settings.frontmatter.map((f) =>
				f.id === updatedFrontmatter.id ? updatedFrontmatter : f
			);

			// Register command for the updated frontmatter
			this.plugin.registerCommand(
				updatedFrontmatter.name,
				async () => await this.plugin.processFrontmatter(updatedFrontmatter.id)
			);

			await this.plugin.saveSettings();
			this.display();
		});
	}

	private async handleDelete(frontmatterSetting: FrontmatterField): Promise<void> {
		const confirmed = await confirmAction(
			this.plugin.app,
			`Are you sure you want to delete "${frontmatterSetting.name}" frontmatter?`
		);
		if (!confirmed) {
			return;
		}

		this.plugin.settings.frontmatter = this.plugin.settings.frontmatter.filter(
			(f: FrontmatterField) => f.id !== frontmatterSetting.id
		);

		await this.plugin.saveSettings();
		this.display();
	}
}
