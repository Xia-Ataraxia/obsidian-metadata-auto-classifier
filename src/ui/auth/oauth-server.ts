import { Platform } from 'obsidian';
import { CODEX_OAUTH } from '../../domain/auth/oauth-constants';
import type { OAuthCallbackResponse } from '../../types/auth';
import { macLogger } from '../../utils/mac-logger';
import { buildOAuthErrorHtml, buildOAuthSuccessHtml } from '../../domain/auth/oauth-response-html';

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

type HttpModule = {
	createServer: (handler: (req: HttpRequest, res: HttpResponse) => void) => HttpServer;
};

function loadHttp(): HttpModule {
	if (Platform.isDesktop) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- loaded via require() in Obsidian's Node context; dynamic import not viable
		return require('http') as HttpModule;
	}
	throw new Error('OAuth callback server is only available on desktop');
}

/**
 * Local OAuth callback server for handling the authorization code redirect
 * Runs on localhost:1455 as required by OpenAI
 * Note: loads 'http' lazily behind Platform.isDesktop so mobile builds keep working
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
		const http = loadHttp();

		return new Promise((resolve, reject) => {
			this.resolveCallback = resolve;
			this.rejectCallback = reject;

			const timeout = window.setTimeout(() => {
				this.stop();
				reject(new Error('OAuth callback timeout - no response received'));
			}, timeoutMs);

			this.server = http.createServer((req: HttpRequest, res: HttpResponse) => {
				this.handleRequest(req, res, expectedState, timeout);
			});

			this.server.on('error', (err: Error) => {
				window.clearTimeout(timeout);
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
				macLogger.info(`OAuth callback server listening on port ${CODEX_OAUTH.REDIRECT_PORT}`);
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
		timeout: number
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
			window.clearTimeout(timeout);
			this.sendErrorResponse(res, `OAuth error: ${error} - ${errorDescription || 'Unknown error'}`);
			this.rejectCallback?.(
				new Error(`OAuth error: ${error} - ${errorDescription || 'Unknown error'}`)
			);
			this.stop();
			return;
		}

		// Validate state to prevent CSRF
		if (state !== expectedState) {
			window.clearTimeout(timeout);
			this.sendErrorResponse(res, 'Invalid state parameter - possible CSRF attack');
			this.rejectCallback?.(new Error('Invalid state parameter - possible CSRF attack'));
			this.stop();
			return;
		}

		// Validate code presence
		if (!code) {
			window.clearTimeout(timeout);
			this.sendErrorResponse(res, 'No authorization code received');
			this.rejectCallback?.(new Error('No authorization code received'));
			this.stop();
			return;
		}

		// Success!
		window.clearTimeout(timeout);
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
			macLogger.info('OAuth callback server stopped');
		}
	}
}
