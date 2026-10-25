import { macLogger } from './mac-logger';

/**
 * Centralized error handling utility for consistent error management across the application.
 */
export class ErrorHandler {
	/**
	 * Record the API failure category without logging caller-provided details.
	 */
	static handleAPIError(_error: unknown, _context?: string): void {
		macLogger.error('api-error');
	}

	/**
	 * Record the validation category without logging caller-provided details.
	 */
	static handleValidationError(_component: string, _message: string): void {
		macLogger.warn('validation-error');
	}

	/**
	 * Record the unexpected-error category without inspecting the thrown value.
	 */
	static handleUnexpectedError(_error: unknown, _context?: string): void {
		macLogger.error('unexpected-error');
	}

	/**
	 * Wrap an async function with error handling.
	 */
	static async wrapAsync<T>(fn: () => Promise<T>, context?: string): Promise<T | null> {
		try {
			return await fn();
		} catch (error) {
			this.handleUnexpectedError(error, context);
			return null;
		}
	}

	/**
	 * Create a safe wrapper for callbacks that shouldn't throw.
	 */
	static safeCallback<T extends (...args: unknown[]) => void>(fn: T, context?: string): T {
		return ((...args: unknown[]) => {
			try {
				fn(...args);
			} catch (error) {
				this.handleUnexpectedError(error, context);
			}
		}) as T;
	}
}
