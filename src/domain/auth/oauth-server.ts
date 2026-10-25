import { CODEX_OAUTH } from './oauth-constants';
import type { OAuthCallbackResponse } from '../../types/auth';
import { macLogger } from '../../utils/mac-logger';
import { buildOAuthErrorHtml, buildOAuthSuccessHtml } from './oauth-response-html';

// Types for Node.js http module (imported dynamically)
type HttpServer = {
	close: () => void;
	listen: (port: number, host: string, callback: () => void) => void;
	on: (event: string, callback: (err: Error) => void) => void;
};

type HttpResponse = {
	writeHead: (statusCode: number, headers?: Record<string, string>) => void;
	end: (data?: string) => void;
};

type HttpRequest = {
	url?: string;
};

/**
 * Local OAuth callback server for handling the authorization code redirect
 * Runs on localhost:1455 as required by OpenAI
 * Note: Uses dynamic import for 'http' module to avoid breaking mobile builds
 */
export class OAuthCallbackServer {
	private server: HttpServer | null = null;
	private resolveCallback: ((response: OAuthCallbackResponse) => void) | null = null;
	private rejectCallback: ((error: Error) => void) | null = null;

	/**
	 * Start the callback server and wait for the authorization code
	 * @param expectedState The state parameter to validate against CSRF attacks
	 * @param timeoutMs Timeout in milliseconds (default: 5 minutes)
	 */
	async waitForCallback(
		expectedState: string,
		timeoutMs: number = 300000
	): Promise<OAuthCallbackResponse> {
		// Dynamic import of http module to avoid breaking mobile builds

		// eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules, no-undef -- http must be loaded via require() in Obsidian's Node context; dynamic import not viable here
		const http = require('http') as {
			createServer: (handler: (req: HttpRequest, res: HttpResponse) => void) => HttpServer;
		};

		return new Promise((resolve, reject) => {
			this.resolveCallback = resolve;
			this.rejectCallback = reject;

			const timeout = setTimeout(() => {
				this.stop();
				reject(new Error('OAuth callback timeout - no response received'));
			}, timeoutMs);

			this.server = http.createServer((req: HttpRequest, res: HttpResponse) => {
				this.handleRequest(req, res, expectedState, timeout);
			});

			this.server.on('error', (err: Error) => {
				clearTimeout(timeout);
				this.stop();
				if ((err as Error & { code?: string }).code === 'EADDRINUSE') {
					reject(
						new Error(
							`Port ${CODEX_OAUTH.REDIRECT_PORT} is already in use. Please close any application using this port.`
						)
					);
				} else {
					reject(err);
				}
			});

			this.server.listen(CODEX_OAUTH.REDIRECT_PORT, '127.0.0.1', () => {
				macLogger.info('oauth-server-started');
			});
		});
	}

	/**
	 * Handle incoming HTTP requests
	 */
	private handleRequest(
		req: HttpRequest,
		res: HttpResponse,
		expectedState: string,
		timeout: ReturnType<typeof setTimeout>
	): void {
		const url = new URL(req.url || '/', `http://localhost:${CODEX_OAUTH.REDIRECT_PORT}`);

		// Only handle the callback path
		if (url.pathname !== '/auth/callback') {
			res.writeHead(404);
			res.end('Not Found');
			return;
		}

		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		const error = url.searchParams.get('error');
		const errorDescription = url.searchParams.get('error_description');

		// Handle OAuth errors
		if (error) {
			clearTimeout(timeout);
			this.sendErrorResponse(res, `OAuth error: ${error} - ${errorDescription || 'Unknown error'}`);
			this.rejectCallback?.(
				new Error(`OAuth error: ${error} - ${errorDescription || 'Unknown error'}`)
			);
			this.stop();
			return;
		}

		// Validate state to prevent CSRF
		if (state !== expectedState) {
			clearTimeout(timeout);
			this.sendErrorResponse(res, 'Invalid state parameter - possible CSRF attack');
			this.rejectCallback?.(new Error('Invalid state parameter - possible CSRF attack'));
			this.stop();
			return;
		}

		// Validate code presence
		if (!code) {
			clearTimeout(timeout);
			this.sendErrorResponse(res, 'No authorization code received');
			this.rejectCallback?.(new Error('No authorization code received'));
			this.stop();
			return;
		}

		// Success!
		clearTimeout(timeout);
		this.sendSuccessResponse(res);
		this.resolveCallback?.({ code, state });
		this.stop();
	}

	/**
	 * Send success HTML response
	 */
	private sendSuccessResponse(res: HttpResponse): void {
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(buildOAuthSuccessHtml());
	}

	/**
	 * Send error HTML response
	 */
	private sendErrorResponse(res: HttpResponse, message: string): void {
		res.writeHead(400, { 'Content-Type': 'text/html' });
		res.end(buildOAuthErrorHtml(message));
	}

	/**
	 * Stop the callback server
	 */
	stop(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
			macLogger.info('oauth-server-stopped');
		}
	}
}
