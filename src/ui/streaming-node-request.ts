import { Platform } from 'obsidian';

type NodeHttps = {
	request: (
		options: Record<string, unknown>,
		callback: (response: NodeResponse) => void
	) => NodeRequest;
};

type NodeRequest = {
	destroy: () => void;
	end: () => void;
	on: (event: 'error', callback: (err: Error) => void) => NodeRequest;
	write: (payload: string) => void;
};

type NodeResponse = {
	statusCode?: number;
	on: (
		event: 'data' | 'end' | 'error',
		callback: ((chunk: Buffer) => void) | (() => void) | ((err: Error) => void)
	) => NodeResponse;
};

function loadHttps(): NodeHttps {
	if (Platform.isDesktop) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- loaded via require() in Obsidian's Node context; dynamic import not viable
		return require('https') as NodeHttps;
	}
	throw new Error('Node HTTPS streaming is only available on desktop');
}

export async function sendStreamingRequestViaNode(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
	timeoutMs: number
): Promise<{ status: number; text: string }> {
	const https = loadHttps();
	const parsedUrl = new URL(url);
	const payload = JSON.stringify(body);
	const payloadLength = Buffer.byteLength(payload);

	return new Promise((resolve, reject) => {
		let timeoutId: number | null = null;
		let isResolved = false;
		const cleanup = () => {
			if (timeoutId) window.clearTimeout(timeoutId);
			timeoutId = null;
		};
		const request = https.request(
			{
				hostname: parsedUrl.hostname,
				port: Number(parsedUrl.port) || 443,
				path: parsedUrl.pathname + parsedUrl.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': payloadLength.toString(),
					...headers,
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => {
					if (isResolved) return;
					isResolved = true;
					cleanup();
					resolve({
						status: response.statusCode ?? 0,
						text: Buffer.concat(chunks).toString('utf8'),
					});
				});
				response.on('error', (err: Error) => {
					if (isResolved) return;
					isResolved = true;
					cleanup();
					reject(err);
				});
			}
		);
		timeoutId = window.setTimeout(() => {
			if (isResolved) return;
			isResolved = true;
			request.destroy();
			reject(new Error(`Stream request timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		request.on('error', (err) => {
			if (isResolved) return;
			isResolved = true;
			cleanup();
			reject(err);
		});
		request.write(payload);
		request.end();
	});
}
