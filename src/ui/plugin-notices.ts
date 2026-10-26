import { ButtonComponent, Notice } from 'obsidian';
import type {
	NoticeCatalog,
	NoticeDefinition,
	NoticeShowOptions,
	PluginNoticesHost,
} from '../types';

const CLS = 'metadata-auto-classifier-notice';

const BUILTIN_NOTICES: NoticeCatalog = {
	notice_muted: {
		template: 'Notice muted. Undo, or reset it in settings.',
		timeout: 4000,
		immutable: true,
		action: 'open-settings',
	},
	notice_unmuted: { template: 'Notice unmuted.', timeout: 2500, immutable: true },
	notice_unmute_failed: {
		template: 'Notice could not be unmuted. Try again in settings.',
		timeout: 6000,
		immutable: true,
		action: 'open-settings',
	},
};

/** Builds the shared notice shell: plugin name head, body text, optional actions. */
export function createNoticeShell(head: string): { root: HTMLElement; row: HTMLElement; content: HTMLElement } {
	const root = createDiv({ cls: CLS });
	root.createEl('p', { cls: `${CLS}-head`, text: head });
	const row = root.createDiv({ cls: `${CLS}-row` });
	const content = row.createEl('p', { cls: `${CLS}-content` });
	return { root, row, content };
}

export class PluginNotices {
	private readonly active = new Map<string, Notice>();

	constructor(
		private readonly plugin: PluginNoticesHost,
		private readonly catalog: NoticeCatalog,
		private readonly head: string
	) {}

	show(id: string, params?: Record<string, unknown>, opts?: NoticeShowOptions): Notice | null {
		if (this.isMuted(id)) return null;

		const definition: NoticeDefinition | undefined = this.catalog[id] ?? BUILTIN_NOTICES[id];
		const template = definition?.template ?? id;
		const timeout = opts?.timeout ?? definition?.timeout ?? 5000;
		const message = this.interpolate(template, params ?? {});
		const settingsButton =
			definition?.action === 'open-settings' && this.plugin.openSettings
				? { text: 'Open settings', callback: this.plugin.openSettings }
				: undefined;
		const buttons = [
			...(opts?.undo ? [{ text: 'Undo', callback: opts.undo }] : []),
			...(opts?.button ? [opts.button] : settingsButton ? [settingsButton] : []),
		];

		// A fresh notice each time so a repeated message is visibly re-announced.
		this.active.get(id)?.hide();
		const notice = new Notice(
			this.buildFragment(id, message, { buttons, immutable: definition?.immutable ?? false }),
			timeout
		);
		this.active.set(id, notice);
		return notice;
	}

	remove(id: string): void {
		this.active.get(id)?.hide();
		this.active.delete(id);
	}

	async mute(id: string): Promise<void> {
		const store = this.getMutedStore();
		store[id] = true;
		await this.plugin.saveSettings();
	}

	async unmute(id: string): Promise<void> {
		const store = this.getMutedStore();
		if (store[id]) {
			delete store[id];
			try {
				await this.plugin.saveSettings();
			} catch (error) {
				// Keep memory in step with disk so Reset in settings can still clear it.
				store[id] = true;
				throw error;
			}
		}
	}

	async unmuteAll(): Promise<void> {
		const store = this.getMutedStore();
		if (Object.keys(store).length === 0) return;
		this.getPluginNoticesSettings().muted = {};
		await this.plugin.saveSettings();
	}

	isMuted(id: string): boolean {
		const store = this.getMutedStore();
		return store[id] === true;
	}

	listMuted(): string[] {
		const store = this.getMutedStore();
		return Object.keys(store)
			.filter((key) => store[key] === true)
			.sort();
	}

	has(id: string): boolean {
		return this.catalog[id] !== undefined;
	}

	unload(): void {
		for (const id of this.active.keys()) {
			this.remove(id);
		}
	}

	private getMutedStore(): Record<string, boolean> {
		return this.getPluginNoticesSettings().muted;
	}

	private getPluginNoticesSettings(): { muted: Record<string, boolean> } {
		const settings = this.plugin.settings;

		if (!settings['plugin_notices'] || typeof settings['plugin_notices'] !== 'object') {
			settings['plugin_notices'] = { muted: {} };
		}

		const notices = settings['plugin_notices'] as Record<string, unknown>;

		if (!notices['muted'] || typeof notices['muted'] !== 'object') {
			notices['muted'] = {};
		}

		return notices as { muted: Record<string, boolean> };
	}

	private interpolate(template: string, params: Record<string, unknown>): string {
		return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key: string) => {
			const value = params[key];
			if (value === null || value === undefined) return '';
			if (typeof value === 'string') return value;
			if (typeof value === 'number' || typeof value === 'boolean') return String(value);
			return JSON.stringify(value);
		});
	}

	private buildFragment(
		id: string,
		text: string,
		opts: { buttons: { text: string; callback: () => void }[]; immutable: boolean }
	): DocumentFragment {
		const fragment = createFragment();
		const { root, row, content } = createNoticeShell(this.head);
		content.setText(text);

		if (!opts.immutable) {
			this.createMuteButton(id, row);
		}

		const buttons = opts.buttons.filter((b) => b.text && typeof b.callback === 'function');
		if (buttons.length > 0) {
			const actions = root.createDiv({ cls: `${CLS}-actions` });
			for (const { text: label, callback } of buttons) {
				const button = new ButtonComponent(actions);
				button.buttonEl.addClass(`${CLS}-action`);
				button.buttonEl.setAttribute('type', 'button');
				button.setButtonText(label).onClick((evt) => {
					evt.stopPropagation();
					try {
						callback();
					} finally {
						this.remove(id);
					}
				});
			}
		}

		fragment.appendChild(root);
		return fragment;
	}

	private async undoMute(id: string): Promise<void> {
		try {
			await this.unmute(id);
			this.show('notice_unmuted');
		} catch {
			this.show('notice_unmute_failed');
		}
	}

	private createMuteButton(id: string, container: HTMLElement): void {
		const button = new ButtonComponent(container);
		button.buttonEl.addClass(`${CLS}-mute`);
		button.buttonEl.setAttribute('type', 'button');
		button.buttonEl.setAttribute('aria-label', `Mute notice: ${id}`);
		button.setIcon('bell-off').setTooltip('Mute this notice').onClick((evt) => {
			// Keep the click from also dismissing the notice before the mute is saved.
			evt.stopPropagation();
			void this.mute(id)
				.then(() => {
					this.remove(id);
					this.show('notice_muted', {}, { undo: () => void this.undoMute(id) });
				})
				.catch(() => {
					console.error('[MAC] Failed to mute notice.');
				});
		});
	}
}
