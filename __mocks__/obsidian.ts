export const requestUrl = vi.fn();

// Platform mock
export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isMacOS: false,
	isWin: false,
	isLinux: false,
	isSafari: false,
};

// Obsidian API functions
export const getFrontMatterInfo = vi.fn((content: string) => {
	const opening = content.match(/^---(?:\r\n|\r|\n)/);
	if (opening) {
		const from = opening[0].length;
		let lineStart = from;
		while (lineStart <= content.length) {
			const newline = content.indexOf('\n', lineStart);
			const lineEnd = newline < 0 ? content.length : newline;
			const contentEnd =
				lineEnd > lineStart && content.charAt(lineEnd - 1) === '\r' ? lineEnd - 1 : lineEnd;
			if (content.slice(lineStart, contentEnd) === '---') {
				const to = lineStart;
				return {
					exists: true,
					frontmatter: content.slice(from, to),
					from,
					to,
					contentStart: newline < 0 ? lineEnd : newline + 1,
				};
			}
			if (newline < 0) break;
			lineStart = newline + 1;
		}
	}
	return {
		exists: false,
		frontmatter: '',
		from: 0,
		to: 0,
		contentStart: 0,
	};
});

export const parseFrontMatterStringArray = vi.fn((frontmatter: any, key: string) => {
	if (!frontmatter || !frontmatter[key]) {
		return null;
	}
	const value = frontmatter[key];
	if (Array.isArray(value)) {
		return value;
	}
	return [value];
});

export const getAllTags = vi.fn((cache: any) => {
	if (!cache) return null;
	const tags = new Set<string>();

	// Add frontmatter tags
	if (cache.frontmatter && cache.frontmatter.tags) {
		const frontmatterTags = Array.isArray(cache.frontmatter.tags)
			? cache.frontmatter.tags
			: [cache.frontmatter.tags];
		frontmatterTags.forEach((tag: string) => tags.add(tag));
	}

	// Add inline tags (simulated)
	if (cache.tags) {
		cache.tags.forEach((tag: any) => tags.add(tag.tag));
	}

	return tags.size > 0 ? Array.from(tags) : null;
});

// MetadataCache mock
export class MetadataCache {
	private fileCaches = new Map<any, any>();

	getFileCache = vi.fn((file: any) => {
		return this.fileCaches.get(file) || null;
	});

	// Helper for testing
	setFileCache(file: any, cache: any) {
		this.fileCaches.set(file, cache);
	}

	clearCache() {
		this.fileCaches.clear();
	}
}

// TFile mock - minimal implementation for testing
export class TFile {
	path: string = '';
	basename: string = '';
	name: string = '';
	extension: string = 'md';
	stat = { ctime: 0, mtime: 0, size: 0 };
	vault: any = null;
	parent: any = null;
}

export function createMockTFile(path: string, basename: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = basename;
	file.name = basename + '.md';
	return file;
}

// Basic App mock for components relying on Obsidian's App
export class App {
	vault = {
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		read: vi.fn().mockResolvedValue(''),
		modify: vi.fn().mockResolvedValue(undefined),
		process: vi.fn(async (file: any, transform: (content: string) => string) => {
			const current = await this.vault.read(file);
			const updated = transform(current);
			await this.vault.modify(file, updated);
			return updated;
		}),
		create: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	} as any;
	metadataCache = new MetadataCache();
	workspace = {
		getActiveFile: vi.fn().mockReturnValue(null),
		on: vi.fn(),
		off: vi.fn(),
	} as any;
	fileManager = {
		processFrontMatter: vi.fn(),
	} as any;
}

export class FuzzySuggestModal<T> {
	constructor(public app: App) {}
	getItems(): T[] {
		return [];
	}
	getItemText(item: T): string {
		return '' + (item as any);
	}
	renderSuggestion(_file: any, _el: HTMLElement): void {}
	onChooseItem(_item: T): void {}
	open(): void {}
	close(): void {}
}

// ---------------------- UI Mocks ----------------------

export class ButtonComponent {
	buttonEl = { addClass: vi.fn(), setAttribute: vi.fn() } as any;
	setButtonText = vi.fn().mockReturnThis();
	setIcon = vi.fn().mockReturnThis();
	setTooltip = vi.fn().mockReturnThis();
	setCta = vi.fn().mockReturnThis();
	setDestructive = vi.fn().mockReturnThis();
	setDisabled = vi.fn().mockReturnThis();
	onClick = vi.fn();
	constructor(public containerEl: HTMLElement) {}
}

export class ExtraButtonComponent {
	extraSettingsEl = { addClass: vi.fn(), setAttribute: vi.fn() } as any;
	setIcon = vi.fn().mockReturnThis();
	setTooltip = vi.fn().mockReturnThis();
	setDisabled = vi.fn().mockReturnThis();
	onClick = vi.fn();
	constructor(public containerEl: HTMLElement) {}
}

export const Notice = vi.fn().mockImplementation(function (message: string, duration: number) {
	this.message = message;
	this.duration = duration;
	this.setMessage = vi.fn();
	this.hide = vi.fn();
	return this;
});

export class Setting {
	settingEl = { addClass: vi.fn(), createSpan: vi.fn() } as any;
	controlEl = { createSpan: vi.fn() } as any;
	constructor(public containerEl: HTMLElement) {}
	setName = vi.fn();
	setDesc = vi.fn();
	setHeading = vi.fn();
	addText = vi.fn();
	addDropdown = vi.fn();
	addToggle = vi.fn();
	addExtraButton = vi.fn();
	addButton = vi.fn();
}

export class TextComponent {
	inputEl = { type: '', style: { width: '' }, value: '', classList: { add: vi.fn() } } as any;
	setPlaceholder = vi.fn();
	setValue = vi.fn();
	onChange = vi.fn();
}

export class TextAreaComponent {
	inputEl = { rows: 0, style: { width: '' } } as any;
	constructor(public containerEl: HTMLElement) {}
	setPlaceholder = vi.fn().mockReturnThis();
	setValue = vi.fn().mockReturnThis();
	onChange = vi.fn().mockReturnThis();
}

// Helper to create a recursive mock element
function createMockElement(): any {
	const mockElement: any = {
		empty: vi.fn(),
		style: {},
		classList: {
			add: vi.fn(),
			remove: vi.fn(),
		},
		setAttribute: vi.fn(),
		querySelector: vi.fn().mockReturnValue(null),
		querySelectorAll: vi.fn().mockReturnValue([]),
		addEventListener: vi.fn(),
		appendChild: vi.fn(),
		value: '',
		checked: false,
	};
	// Recursive mock for createEl and createDiv
	mockElement.createEl = vi.fn().mockImplementation(() => createMockElement());
	mockElement.createDiv = vi.fn().mockImplementation(() => createMockElement());
	return mockElement;
}

// Modal mock
export class Modal {
	app: App;
	contentEl: HTMLElement;
	modalEl: HTMLElement;

	constructor(app: App) {
		this.app = app;
		this.contentEl = createMockElement() as any;
		this.modalEl = {
			addClass: vi.fn(),
		} as any;
	}

	open = vi.fn();
	close = vi.fn();
	onOpen(): void {}
	onClose(): void {}
}

// Plugin mock
export class Plugin {
	app: App;
	manifest: any = { id: 'test-plugin', name: 'Test Plugin', version: '1.0.0' };

	constructor(app?: App) {
		this.app = app || new App();
	}

	loadData = vi.fn().mockResolvedValue({});
	saveData = vi.fn().mockResolvedValue(undefined);
	addCommand = vi.fn();
	addSettingTab = vi.fn();

	onload(): Promise<void> | void {}
	onunload(): void {}
}

// PluginSettingTab mock
export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = {
			empty: vi.fn(),
			createEl: vi.fn(),
			createDiv: vi.fn(),
		} as any;
	}

	display(): void {}
	hide(): void {}
}

// Vault mock
export class Vault {
	getMarkdownFiles = vi.fn().mockReturnValue([]);
	read = vi.fn().mockResolvedValue('');
	modify = vi.fn().mockResolvedValue(undefined);
	process = vi.fn(async (file: any, transform: (content: string) => string) => {
		const updated = transform(await this.read(file));
		await this.modify(file, updated);
		return updated;
	});
	create = vi.fn().mockResolvedValue(undefined);
	delete = vi.fn().mockResolvedValue(undefined);
}

// FileManager mock
export class FileManager {
	processFrontMatter = vi.fn();
}

// Workspace mock
export class Workspace {
	getActiveFile = vi.fn().mockReturnValue(null);
	on = vi.fn();
	off = vi.fn();
}
