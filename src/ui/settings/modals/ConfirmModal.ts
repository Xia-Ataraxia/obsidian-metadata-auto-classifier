import { App, Modal, Setting } from 'obsidian';

class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly message: string,
		private readonly onResolve: (confirmed: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText('Confirm')
					.setCta()
					.onClick(() => {
						this.confirmed = true;
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onResolve(this.confirmed);
	}
}

export function confirmAction(app: App, message: string): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, message, resolve).open());
}
