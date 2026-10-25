import { Notice as ObsidianNotice } from 'obsidian';

// Maximum duration for progress spinner (30 seconds)
const MAX_PROGRESS_DURATION_MS = 30000;

export class Notice {
	private static show(message: string, duration: number): void {
		new ObsidianNotice(message, duration);
	}

	/**
	 * Format a validation error message with component context
	 * @param component - The component name (e.g., 'Provider', 'Model')
	 * @param message - The error message
	 * @returns Formatted error message: [Component] Message
	 */
	static formatValidationError(component: string, message: string): string {
		return `[${component}] ${message}`;
	}

	/**
	 * Show a validation error with component context
	 */
	static validationError(component: string, message: string): void {
		const formattedMessage = this.formatValidationError(component, message);
		this.error(new Error(formattedMessage));
	}

	static error(error: Error): void {
		this.show(`❌ ${error.message}`, 5000);
		console.error(error);
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
			window.clearInterval(notice.interval);
		}
		if (notice.timeout) {
			window.clearTimeout(notice.timeout);
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
