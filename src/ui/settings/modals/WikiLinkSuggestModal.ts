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
		this.setPlaceholder('Search notes');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	renderSuggestion(file: FuzzyMatch<TFile>, el: HTMLElement): void {
		el.addClass('mod-complex');
		const content = el.createDiv({ cls: 'suggestion-content' });
		content.createDiv({ cls: 'suggestion-title', text: file.item.basename });
		content.createDiv({ cls: 'suggestion-note', text: file.item.path });
	}

	onChooseItem(file: TFile): void {
		this.onItemSelected(file);
		this.close();
	}
}
