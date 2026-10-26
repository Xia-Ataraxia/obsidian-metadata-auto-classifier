import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['./__tests__/setup.ts'],
		include: ['__tests__/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
		},
		server: { deps: { inline: true } },
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./__mocks__/obsidian.ts', import.meta.url)),
		},
	},
});
