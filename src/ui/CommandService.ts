import type { Plugin } from 'obsidian';

import type { FrontmatterField } from '../types';

export interface CommandHandler {
	processFrontmatter: (frontmatterId: number) => Promise<void>;
	processAllFrontmatter: () => Promise<void>;
}

export class CommandService {
	constructor(
		private readonly plugin: Plugin,
		private readonly handler: CommandHandler
	) {}

	setupCommands(frontmatterSettings: FrontmatterField[]): void {
		// Register individual frontmatter commands
		frontmatterSettings.forEach((fm) => {
			this.registerCommand(fm.name, async () => await this.handler.processFrontmatter(fm.id));
		});

		// Register "fetch all" command
		// The id predates the rename and must stay stable for user hotkeys.
		this.plugin.addCommand({
			id: 'fetch-frontmatter-Fetch all frontmatter using current provider',
			name: 'Fetch all frontmatter',
			callback: async () => await this.handler.processAllFrontmatter(),
		});
	}

	registerCommand(name: string, callback: () => Promise<void>): void {
		// Unnamed fields are drafts from "+ Add frontmatter"; a blank command name is unusable.
		if (!name.trim()) return;
		this.plugin.addCommand({
			id: `fetch-frontmatter-${name}`,
			name: `Fetch frontmatter: ${name}`,
			callback: async () => await callback(),
		});
	}
}
