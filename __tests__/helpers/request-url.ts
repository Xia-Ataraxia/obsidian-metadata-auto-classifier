import type { RequestUrlResponse, RequestUrlResponsePromise } from 'obsidian';

type RequestUrlResponseExecutor = (
	resolve: (value: RequestUrlResponse | PromiseLike<RequestUrlResponse>) => void,
	reject: (reason?: unknown) => void
) => void;

class RequestUrlPromiseFixture extends Promise<RequestUrlResponse> implements RequestUrlResponsePromise {
	static get [Symbol.species](): PromiseConstructor {
		return Promise;
	}

	constructor(executor: RequestUrlResponseExecutor) {
		super((resolve, reject) => {
			executor(
				(value) => resolve(value),
				(reason) => reject(reason)
			);
		});
	}

	get arrayBuffer(): Promise<ArrayBuffer> {
		return this.then((response) => response.arrayBuffer);
	}

	get json(): RequestUrlResponsePromise['json'] {
		return this.then((response) => response.json);
	}

	get text(): Promise<string> {
		return this.then((response) => response.text);
	}
}

export function requestUrlPromise(
	response: RequestUrlResponse | RequestUrlResponseExecutor
): RequestUrlResponsePromise {
	return new RequestUrlPromiseFixture(
		typeof response === 'function' ? response : (resolve) => resolve(response)
	);
}
