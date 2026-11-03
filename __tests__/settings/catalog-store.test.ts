import type { DataAdapter } from 'obsidian';
import { getBundledCatalog } from '../../src/domain/model-catalog';
import { CatalogStore } from '../../src/ui/catalog-store';

function adapterWith(content: string | null): DataAdapter {
	return {
		exists: async () => content !== null,
		read: async () => content ?? '',
	} as unknown as DataAdapter;
}

describe('CatalogStore.load', () => {
	test('reports a saved copy only once, so a re-render on true cannot loop', async () => {
		const saved = { ...getBundledCatalog(), generatedAt: '2030-01-01' };
		const store = new CatalogStore(adapterWith(JSON.stringify(saved)), 'config', 'plugin');

		expect(await store.load()).toBe(true);
		expect(store.current.generatedAt).toBe('2030-01-01');
		expect(await store.load()).toBe(false);
		expect(store.current.generatedAt).toBe('2030-01-01');
	});

	test('ignores a saved copy older than the bundled snapshot', async () => {
		const saved = { ...getBundledCatalog(), generatedAt: '2000-01-01' };
		const store = new CatalogStore(adapterWith(JSON.stringify(saved)), 'config', 'plugin');

		expect(await store.load()).toBe(false);
		expect(store.current.generatedAt).toBe(getBundledCatalog().generatedAt);
	});

	test('keeps the bundled snapshot when nothing is saved', async () => {
		const store = new CatalogStore(adapterWith(null), 'config', 'plugin');

		expect(await store.load()).toBe(false);
		expect(store.current.generatedAt).toBe(getBundledCatalog().generatedAt);
	});
});
