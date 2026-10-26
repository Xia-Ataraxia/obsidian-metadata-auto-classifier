import type { TFile } from 'obsidian';
import { Plugin } from 'obsidian';
import { CodexOAuth, isTokenExpired } from './ui/auth';
import { ClassificationService } from './ui/ClassificationService';
import { CommandService } from './ui/CommandService';
import { DEFAULT_FRONTMATTER_SETTING, DEFAULT_SETTINGS, NOTICE_CATALOG } from './domain/constants';
import { migrateSettings } from './domain/settings-migration';
import type { AutoClassifierSettings, FrontmatterField, ProviderConfig } from './types';
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

	async onload() {
		this.logger = new PluginLogger('MAC');
		Notice.head = this.manifest.name;

		await this.loadSettings();
		await this.runMigrateSettings();
		await this.refreshOAuthTokensIfNeeded();
		try {
			this.setupCommand();
		} catch (error) {
			this.logger.error('Failed to setup commands', { error: String(error) });
			this.notices.show('init_failed');
		}
		this.addSettingTab(new AutoClassifierSettingTab(this));
	}

	onunload() {
		this.notices?.unload();
	}

	/**
	 * Refresh OAuth tokens for all providers that use OAuth authentication
	 * Supports both new auth field and legacy oauth field
	 */
	private async refreshOAuthTokensIfNeeded(): Promise<void> {
		const oauthProviders = this.settings.providers.filter(
			(p) => (p.authType === 'oauth' && p.oauth) || (p.auth?.type === 'oauth' && p.auth.oauth)
		);

		if (oauthProviders.length === 0) return;

		const codexOAuth = new CodexOAuth();
		let settingsChanged = false;

		for (const provider of oauthProviders) {
			// Get oauth from either new auth field or legacy oauth field
			const oauth = provider.auth?.type === 'oauth' ? provider.auth.oauth : provider.oauth;
			if (!oauth || !isTokenExpired(oauth)) continue;

			try {
				const newTokens = await codexOAuth.refreshTokens(oauth);
				// Update the oauth in the correct location
				if (provider.auth?.type === 'oauth') {
					provider.auth.oauth = newTokens;
				} else {
					provider.oauth = newTokens;
				}
				settingsChanged = true;
				this.logger.info(`OAuth tokens refreshed for provider: ${provider.name}`);
			} catch (error) {
				this.logger.error(`Failed to refresh OAuth tokens for ${provider.name}`, {
					error: String(error),
				});
			}
		}

		if (settingsChanged) {
			await this.saveSettings();
		}
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
		const frontmatterIds = this.settings.frontmatter.map((fm) => fm.id);
		for (const frontmatterId of frontmatterIds) {
			await this.processFrontmatter(frontmatterId);
		}
	}

	async processFrontmatter(frontmatterId: number): Promise<void> {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) {
			this.notices.show('no_active_file');
			return;
		}

		let selectedProvider: ProviderConfig | null = null;
		try {
			selectedProvider = this.getSelectedProvider();
		} catch {
			this.notices.show('no_provider_selected');
			return;
		}

		const frontmatter = this.settings.frontmatter.find((fm) => fm.id === frontmatterId);
		if (!frontmatter) {
			this.notices.show('no_frontmatter_setting', { id: frontmatterId });
			return;
		}

		await this.classifyFrontmatter(selectedProvider, currentFile, frontmatter);
	}

	private async classifyFrontmatter(
		provider: ProviderConfig,
		file: TFile,
		frontmatter: FrontmatterField
	): Promise<void> {
		this.classificationService = new ClassificationService({
			app: this.app,
			provider,
			model: this.settings.selectedModel,
			classificationRule: this.settings.classificationRule,
			saveSettings: () => this.saveSettings(),
			notices: this.notices,
		});

		await this.classificationService.classify(file, frontmatter);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		) as typeof DEFAULT_SETTINGS;

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

	/**
	 * Migrate legacy settings to the repo-local settings shape
	 */
	private async runMigrateSettings(): Promise<void> {
		const raw = this.settings as unknown as Record<string, unknown>;

		const { data, changed } = migrateSettings(raw, [
			(data) => {
				// Migrate legacy codexConnection to Codex provider's oauth field
				if (!data['codexConnection']) return data;

				const providers = data['providers'] as Array<Record<string, unknown>> | undefined;
				const codexProvider = providers?.find((p) => p['name'] === 'Codex');
				if (codexProvider && !codexProvider['oauth']) {
					codexProvider['oauth'] = data['codexConnection'];
					codexProvider['authType'] = 'oauth';
					this.logger.info('Migrated codexConnection to Codex provider oauth field');
				}
				// Remove legacy field
				const { codexConnection: _removed, ...rest } = data;
				return rest;
			},
		]);

		if (changed) {
			this.settings = data as unknown as AutoClassifierSettings;
			// Re-bind notices host after settings object is replaced
			this.notices = this.createNotices();
			await this.saveSettings();
		}
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

	public getSelectedProvider(): ProviderConfig {
		const provider = this.settings.providers.find(
			(provider) => provider.name === this.settings.selectedProvider
		);
		if (!provider) throw new Error('Selected provider not found');

		return provider;
	}
}
