/// <reference types="vite/client" />
import { NOTICE_CATALOG } from '../../src/domain/constants';

const sources = import.meta.glob<string>('../../src/**/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
});

describe('notice catalog', () => {
	it('defines every notice key passed to notices.show', () => {
		const used = new Set<string>();
		for (const text of Object.values(sources))
			for (const match of text.matchAll(/notices\.show\(\s*'([a-z_]+)'/g)) used.add(match[1] as string);
		expect(used.size).toBeGreaterThan(5);
		expect([...used].filter((key) => !(key in NOTICE_CATALOG))).toEqual([]);
	});
});
