import { Plugin } from 'obsidian';
import { ClassificationService } from './ui/ClassificationService';
import { CommandService } from './ui/CommandService';
import { DEFAULT_FRONTMATTER_SETTING, DEFAULT_SETTINGS, NOTICE_CATALOG } from './domain/constants';
import type { AutoClassifierSettings } from './types';
import { AutoClassifierSettingTab } from './ui/settings';
import { PluginNotices } from './ui/plugin-notices';
import { Notice } from './ui/settings/components/Notice';
import { PluginLogger } from './utils/plugin-logger';

export default class AutoClassifierPlugin extends Plugin {
	settings!: AutoClassifierSettings;
	logger!: PluginLogger;
	notices!: PluginNotices;

	private classificationService: ClassificationService | null = null;
	private commandService: CommandService | null = null;
	private active = false;
	private lifecycleGeneration = 0;

	isActive(): boolean {
		return this.active;
	}

	async onload() {
		const generation = ++this.lifecycleGeneration;
		this.active = false;
		this.classificationService?.deactivate();
		this.logger = new PluginLogger();
		Notice.head = this.manifest.name;

		await this.loadSettings();
		if (generation !== this.lifecycleGeneration) return;
		this.active = true;
		this.classificationService = new ClassificationService({
			app: this.app,
			getSettings: () => this.settings,
			isActive: () => this.active,
			saveSettings: () => this.saveSettings(),
			notices: this.notices,
		});
		try {
			this.setupCommand();
		} catch {
			this.logger.error('initialization-failed');
			this.notices.show('init_failed');
		}
		this.addSettingTab(new AutoClassifierSettingTab(this));
	}

	onunload(): void {
		++this.lifecycleGeneration;
		this.active = false;
		this.classificationService?.deactivate();
		this.notices?.unload();
	}

	setupCommand() {
		this.commandService = new CommandService(this, {
			processFrontmatter: (id) => this.processFrontmatter(id),
			processAllFrontmatter: () => this.processAllFrontmatter(),
		});
		this.commandService.setupCommands(this.settings.frontmatter);
	}

	registerCommand(name: string, callback: () => Promise<void>) {
		this.addCommand({
			id: `fetch-frontmatter-${name}`,
			name: `Fetch frontmatter: ${name}`,
			callback: async () => await callback(),
		});
	}

	async processAllFrontmatter(): Promise<void> {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) {
			this.notices.show('no_active_file');
			return;
		}
		const service = this.classificationService;
		const frontmatterIds = this.settings.frontmatter.map((field) => field.id);
		for (const frontmatterId of frontmatterIds) {
			await service?.classify(currentFile, frontmatterId);
		}
	}

	async processFrontmatter(frontmatterId: number): Promise<void> {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) {
			this.notices.show('no_active_file');
			return;
		}

		if (!this.settings.frontmatter.some((field) => field.id === frontmatterId)) {
			this.notices.show('no_frontmatter_setting', { id: frontmatterId });
			return;
		}
		await this.classificationService?.classify(currentFile, frontmatterId);
	}

	async loadSettings() {
		const generation = this.lifecycleGeneration;
		const storedSettings: unknown = await this.loadData();
		if (generation !== this.lifecycleGeneration) return;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			storedSettings
		);
		this.settings.jev = { ...DEFAULT_SETTINGS.jev, ...this.settings.jev };

		// Migrate old frontmatter settings that may be missing count
		this.settings.frontmatter = this.settings.frontmatter.map((fm) => ({
			...DEFAULT_FRONTMATTER_SETTING,
			...fm,
			count: fm.count ?? { min: 1, max: 5 },
		}));

		// Initialize notices after settings are loaded so the mute store is available
		this.notices = this.createNotices();

		await this.saveSettings();
	}

	private createNotices(): PluginNotices {
		return new PluginNotices(
			{
				settings: this.settings as unknown as Record<string, unknown>,
				saveSettings: () => this.saveSettings(),
				openSettings: () => this.openSettings(),
			},
			NOTICE_CATALOG,
			this.manifest.name
		);
	}

	openSettings(): void {
		// App#setting is not in the public typings.
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } })
			.setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
