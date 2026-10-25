import type { TFile, App, FuzzyMatch } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';

/**
 * Modal for searching and selecting wiki links from existing files in the vault
 */

export class WikiLinkSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		readonly onItemSelected: (file: TFile) => void
	) {
		super(app);
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	renderSuggestion(file: FuzzyMatch<TFile>, el: HTMLElement): void {
		el.createDiv({ text: file.item.basename });
		el.createEl('small', { text: file.item.path });
	}

	onChooseItem(file: TFile): void {
		this.onItemSelected(file);
		this.close();
	}
}
