/**
 * Helper class for modal accessibility features.
 * Provides tab trapping and focus management.
 */
export class ModalAccessibilityHelper {
	private keydownHandler?: (e: KeyboardEvent) => void;

	/**
	 * Setup tab trapping within a modal content element.
	 * Prevents focus from escaping the modal when using Tab key.
	 */
	setupTabTrapping(contentEl: HTMLElement): void {
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key === 'Tab') {
				const focusableElements = contentEl.querySelectorAll(
					'input, select, button, textarea, [tabindex]:not([tabindex="-1"])'
				);
				if (focusableElements.length === 0) return;

				const firstElement = focusableElements[0] as HTMLElement;
				const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

				if (e.shiftKey && document.activeElement === firstElement) {
					e.preventDefault();
					lastElement.focus();
				} else if (!e.shiftKey && document.activeElement === lastElement) {
					e.preventDefault();
					firstElement.focus();
				}
			}
		};

		contentEl.addEventListener('keydown', this.keydownHandler);
	}

	/**
	 * Focus the first focusable input element in the modal.
	 */
	focusFirstInput(contentEl: HTMLElement): void {
		window.setTimeout(() => {
			const firstInput = contentEl.querySelector('input, select, button, textarea') as HTMLElement;
			if (firstInput) {
				firstInput.focus();
			}
		}, 50);
	}

	/**
	 * Setup both tab trapping and initial focus.
	 */
	setup(contentEl: HTMLElement): void {
		this.setupTabTrapping(contentEl);
		this.focusFirstInput(contentEl);
	}

	/**
	 * Cleanup event listeners. Should be called in modal's onClose.
	 */
	cleanup(contentEl: HTMLElement): void {
		if (this.keydownHandler) {
			contentEl.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = undefined;
		}
	}
}
