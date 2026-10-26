import type { FrontmatterField } from '../../../types';
import type AutoClassifierPlugin from '../../../main';
import { ConfigurableSettingModal } from '../modals/FrontmatterEditorModal';
import type {
	FrontmatterActions,
	FrontmatterEditorModalProps,
	SettingsComponent,
	SettingsComponentOptions,
} from '../../../types';
import { Setting } from './Setting';

export abstract class BaseSettingsComponent implements SettingsComponent {
	protected abstract readonly options: SettingsComponentOptions;

	constructor(
		protected readonly plugin: AutoClassifierPlugin,
		protected readonly containerEl: HTMLElement
	) {}

	abstract display(frontmatterId?: number): void;

	protected createFrontmatterSetting(
		containerEl: HTMLElement,
		frontmatterSetting: FrontmatterField,
		actions: FrontmatterActions,
		showDeleteButton: boolean = false
	): void {
		const button = [
			{
				icon: 'pencil',
				text: 'Edit',
				onClick: () => actions.onEdit(frontmatterSetting),
			},
		];
		if (showDeleteButton) {
			button.push({
				icon: 'trash',
				text: 'Delete',
				onClick: () => actions.onDelete(frontmatterSetting),
			});
		}

		Setting.create(containerEl, {
			name: frontmatterSetting.name || 'Untitled',
			desc: `${frontmatterSetting.linkType} · up to ${frontmatterSetting.count?.max ?? 5} · ${frontmatterSetting.overwrite ? 'overwrite' : 'append'}`,
			buttons: button,
		});
	}

	// Common modal creation and opening logic
	protected openEditModal(
		frontmatterSetting: FrontmatterField,
		onSave: (updatedFrontmatter: FrontmatterField) => Promise<void>
	): void {
		const modalProps: FrontmatterEditorModalProps = {
			frontmatterSetting: frontmatterSetting,
			options: this.options,
			onSave: onSave,
		};

		const modal = new ConfigurableSettingModal(this.plugin.app, modalProps);
		modal.open();
	}
}
