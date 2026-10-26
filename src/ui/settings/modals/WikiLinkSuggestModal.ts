import type { App, FuzzyMatch, TAbstractFile } from 'obsidian';
import { FuzzySuggestModal, TFile, TFolder, setIcon } from 'obsidian';

/**
 * Browses one folder at a time (TFolder.children) to pick a note as a wiki link.
 * Choosing a folder steps into it instead of closing, so the vault is never listed wholesale.
 */
export class WikiLinkSuggestModal extends FuzzySuggestModal<TAbstractFile> {
	private folder: TFolder;

	constructor(
		app: App,
		readonly onItemSelected: (file: TFile) => void
	) {
		super(app);
		this.folder = app.vault.getRoot();
		this.setInstructions([
			{ command: '↵', purpose: 'open folder or pick note' },
			{ command: 'esc', purpose: 'close' },
		]);
		this.updatePlaceholder();
	}

	getItems(): TAbstractFile[] {
		const children = this.folder.children.filter(
			(item) => item instanceof TFolder || (item instanceof TFile && item.extension === 'md')
		);
		children.sort(
			(a, b) =>
				Number(b instanceof TFolder) - Number(a instanceof TFolder) || a.name.localeCompare(b.name)
		);
		return this.folder.parent ? [this.folder.parent, ...children] : children;
	}

	getItemText(item: TAbstractFile): string {
		return item instanceof TFile ? item.basename : item.name;
	}

	renderSuggestion(match: FuzzyMatch<TAbstractFile>, el: HTMLElement): void {
		const item = match.item;
		const isParent = item === this.folder.parent;
		el.addClass('mod-complex');
		const content = el.createDiv({ cls: 'suggestion-content' });
		content.createDiv({
			cls: 'suggestion-title',
			text: isParent ? 'Up one folder' : this.getItemText(item),
		});
		if (item instanceof TFile) {
			content.createDiv({ cls: 'suggestion-note', text: item.path });
			return;
		}
		const flair = el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair' });
		setIcon(flair, isParent ? 'corner-left-up' : 'folder');
	}

	selectSuggestion(match: FuzzyMatch<TAbstractFile>, evt: MouseEvent | KeyboardEvent): void {
		if (match.item instanceof TFolder) {
			this.folder = match.item;
			this.updatePlaceholder();
			this.inputEl.value = '';
			this.inputEl.dispatchEvent(new Event('input'));
			return;
		}
		super.selectSuggestion(match, evt);
	}

	onChooseItem(item: TAbstractFile): void {
		if (item instanceof TFile) this.onItemSelected(item);
	}

	private updatePlaceholder(): void {
		this.setPlaceholder(this.folder.isRoot() ? 'Search notes' : `Search ${this.folder.name}`);
	}
}
