import { Component, Notice as ObsidianNotice } from 'obsidian';
import { createNoticeShell } from '../../plugin-notices';

// Safety cap so a request that never settles cannot leave the notice up forever.
const MAX_PROGRESS_DURATION_MS = 120000;
const STILL_WAITING_AFTER_MS = 15000;

type ProgressNotice = { notice: ObsidianNotice; scope: Component };

export class Notice {
	/** Plugin name shown at the top of every progress notice; set on load. */
	static head = '';

	private static show(message: string, duration: number): void {
		new ObsidianNotice(message, duration);
	}

	private static showError(message: string): void {
		this.show(`❌ ${message}`, 5000);
	}

	/**
	 * Return a validation category without exposing caller-provided details.
	 */
	static formatValidationError(_component: string, _message: string): string {
		return '[Validation] Validation failed.';
	}

	/**
	 * Show a validation error without exposing caller-provided details.
	 */
	static validationError(component: string, message: string): void {
		this.showError(this.formatValidationError(component, message));
		console.error('[MAC] [Validation] Validation failed.');
	}

	static error(_error: unknown): void {
		this.showError('An error occurred.');
		console.error('[MAC] An error occurred.');
	}

	static success(message: string): void {
		this.show(message, 3000);
	}

	static startProgress(displayText: string): ProgressNotice {
		const fragment = createFragment();
		const { root, content } = createNoticeShell(this.head);
		root.addClass('metadata-auto-classifier-notice--progress');
		content.createSpan({ cls: 'metadata-auto-classifier-notice-spinner' });
		const textEl = content.createSpan({ text: displayText });
		fragment.appendChild(root);

		const notice = new ObsidianNotice(fragment, 0);
		const scope = new Component();
		const progress: ProgressNotice = { notice, scope };
		scope.load();

		const waitingTimer = window.setTimeout(() => {
			textEl.setText(`${displayText.replace(/…$/, '')}, still waiting…`);
		}, STILL_WAITING_AFTER_MS);
		const capTimer = window.setTimeout(() => {
			this.endProgress(progress);
		}, MAX_PROGRESS_DURATION_MS);
		scope.register(() => {
			window.clearTimeout(waitingTimer);
			window.clearTimeout(capTimer);
			notice.hide();
		});

		return progress;
	}

	static endProgress(progress: ProgressNotice): void {
		progress.scope.unload();
	}

	static async withProgress<T>(
		fileName: string,
		frontmatterName: string,
		fn: () => Promise<T>
	): Promise<T> {
		const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
		const progressNotice = this.startProgress(`Tagging ${fileNameWithoutExt} (${frontmatterName})…`);
		try {
			return await fn();
		} finally {
			this.endProgress(progressNotice);
		}
	}
}
