import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['__tests__/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
		},
		server: {
			deps: {
				inline: true,
			},
		},
	},
	resolve: {
		alias: [
			// Obsidian mock
			{ find: 'obsidian', replacement: path.resolve(__dirname, '__mocks__/obsidian.ts') },
			// Main entry
			{ find: 'main', replacement: path.resolve(__dirname, 'src/main') },
			// New layered architecture aliases
			{ find: 'domain', replacement: path.resolve(__dirname, 'src/domain') },
			{ find: 'ui', replacement: path.resolve(__dirname, 'src/ui') },
			{ find: 'types', replacement: path.resolve(__dirname, 'src/types') },
			{ find: 'utils', replacement: path.resolve(__dirname, 'src/utils') },
			// Legacy aliases — map old paths to new locations for test backward compat
			// More specific paths must come before less specific ones
			{
				find: 'provider/UnifiedProvider',
				replacement: path.resolve(__dirname, 'src/ui/UnifiedProvider'),
			},
			{ find: 'provider/request', replacement: path.resolve(__dirname, 'src/ui/request') },

			{ find: 'provider/auth/oauth', replacement: path.resolve(__dirname, 'src/ui/auth/oauth') },
			{ find: 'provider/auth', replacement: path.resolve(__dirname, 'src/ui/auth/index') },
			{ find: 'provider', replacement: path.resolve(__dirname, 'src/ui/provider-api') },
			{ find: 'lib/frontmatter', replacement: path.resolve(__dirname, 'src/ui/frontmatter') },

			{ find: 'lib/ErrorHandler', replacement: path.resolve(__dirname, 'src/utils/ErrorHandler') },
			{ find: 'lib', replacement: path.resolve(__dirname, 'src/utils/lib-utils') },
			{
				find: 'settings/components/Notice',
				replacement: path.resolve(__dirname, 'src/ui/settings/components/Notice'),
			},
			{
				find: 'settings/modals/ProviderModal',
				replacement: path.resolve(__dirname, 'src/ui/settings/modals/ProviderModal'),
			},
			{
				find: 'settings/modals/ModelModal',
				replacement: path.resolve(__dirname, 'src/ui/settings/modals/ModelModal'),
			},
			{
				find: 'settings/ApiSection',
				replacement: path.resolve(__dirname, 'src/ui/settings/ApiSection'),
			},
			{
				find: 'settings/TagSection',
				replacement: path.resolve(__dirname, 'src/ui/settings/TagSection'),
			},
			{
				find: 'settings/FrontmatterSection',
				replacement: path.resolve(__dirname, 'src/ui/settings/FrontmatterSection'),
			},
			{
				find: 'settings/ProviderSection',
				replacement: path.resolve(__dirname, 'src/ui/settings/ProviderSection'),
			},
			{
				find: 'settings/ModelSection',
				replacement: path.resolve(__dirname, 'src/ui/settings/ModelSection'),
			},
			{ find: 'settings', replacement: path.resolve(__dirname, 'src/ui/settings/index') },
			{
				find: 'classifier/ClassificationService',
				replacement: path.resolve(__dirname, 'src/ui/ClassificationService'),
			},
			{
				find: 'classifier/CommandService',
				replacement: path.resolve(__dirname, 'src/ui/CommandService'),
			},
			{ find: 'classifier', replacement: path.resolve(__dirname, 'src/ui/ClassificationService') },
		],
	},
});
