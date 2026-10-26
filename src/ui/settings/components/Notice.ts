import { Notice as ObsidianNotice } from 'obsidian';
import { createNoticeShell } from '../../plugin-notices';

// Safety cap so a request that never settles cannot leave the notice up forever.
const MAX_PROGRESS_DURATION_MS = 120000;
const STILL_WAITING_AFTER_MS = 15000;

type ProgressNotice = ObsidianNotice & { waitingTimer?: number; capTimer?: number };

export class Notice {
	/** Plugin name shown at the top of every progress notice; set on load. */
	static head = '';

	static startProgress(displayText: string): ProgressNotice {
		const fragment = createFragment();
		const { root, content } = createNoticeShell(this.head);
		root.addClass('metadata-auto-classifier-notice--progress');
		content.createSpan({ cls: 'metadata-auto-classifier-notice-spinner' });
		const textEl = content.createSpan({ text: displayText });
		fragment.appendChild(root);

		const notice: ProgressNotice = new ObsidianNotice(fragment, 0);
		notice.waitingTimer = window.setTimeout(() => {
			textEl.setText(`${displayText} · still waiting…`);
		}, STILL_WAITING_AFTER_MS);
		notice.capTimer = window.setTimeout(() => {
			this.endProgress(notice);
		}, MAX_PROGRESS_DURATION_MS);

		return notice;
	}

	static endProgress(notice: ProgressNotice): void {
		window.clearTimeout(notice.waitingTimer);
		window.clearTimeout(notice.capTimer);
		notice.hide();
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
