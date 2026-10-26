import { App, Modal, Setting } from 'obsidian';

class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly onResolve: (confirmed: boolean) => void
	) {
		super(app);
	}

	private confirm(): void {
		this.confirmed = true;
		this.close();
	}

	onOpen(): void {
		this.scope.register([], 'Enter', () => {
			this.confirm();
			return false;
		});
		this.contentEl.createEl('p', { text: this.message });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => {
				// setDestructive needs Obsidian 1.13; mod-warning is the same style on older builds
				btn.buttonEl.addClass('mod-warning');
				btn.setButtonText(this.confirmLabel).onClick(() => this.confirm());
			});
	}

	onClose(): void {
		this.contentEl.empty();
		this.onResolve(this.confirmed);
	}
}

export function confirmAction(app: App, message: string, confirmLabel: string): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, message, confirmLabel, resolve).open());
}
