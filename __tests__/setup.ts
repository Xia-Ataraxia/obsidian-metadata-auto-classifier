import { beforeEach, vi } from 'vitest';

// Obsidian runs in a browser; these Node tests share the fake-clock timer surface.
beforeEach(() => {
	vi.stubGlobal('window', {
		setTimeout: (callback: () => void, delay?: number) => setTimeout(callback, delay),
		clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
	});
});
