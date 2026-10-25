import { Notice as ObsidianNotice } from 'obsidian';

// Maximum duration for progress spinner (30 seconds)
const MAX_PROGRESS_DURATION_MS = 30000;

export class Notice {
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

	static startProgress(
		displayText: string
	): ObsidianNotice & { interval?: number; timeout?: number } {
		const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
		let spinIndex = 0;

		const noticeText = () => `${spinChars[spinIndex]} ${displayText}`;
		const notice = new ObsidianNotice(noticeText(), 0) as ObsidianNotice & {
			interval?: number;
			timeout?: number;
		};

		notice.interval = window.setInterval(() => {
			spinIndex = (spinIndex + 1) % spinChars.length;
			notice.setMessage(noticeText());
		}, 100);

		// Auto-cleanup after MAX_PROGRESS_DURATION to prevent infinite intervals
		notice.timeout = window.setTimeout(() => {
			this.endProgress(notice);
		}, MAX_PROGRESS_DURATION_MS);

		return notice;
	}

	static endProgress(notice: ObsidianNotice & { interval?: number; timeout?: number }): void {
		if (notice.interval) {
			clearInterval(notice.interval);
		}
		if (notice.timeout) {
			clearTimeout(notice.timeout);
		}
		notice.hide();
	}

	static async withProgress<T>(
		fileName: string,
		frontmatterName: string,
		fn: () => Promise<T>
	): Promise<T> {
		const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
		const progressNotice = this.startProgress(`Tagging ${fileNameWithoutExt} (${frontmatterName})`);
		try {
			const result = await fn();
			return result;
		} finally {
			this.endProgress(progressNotice);
		}
	}
}
