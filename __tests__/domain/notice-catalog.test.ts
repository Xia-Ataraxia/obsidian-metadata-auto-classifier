import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NOTICE_CATALOG } from '../../src/domain/constants';

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
	});
}

describe('notice catalog', () => {
	it('defines every notice key passed to notices.show', () => {
		const used = new Set<string>();
		for (const file of sources('src'))
			for (const match of readFileSync(file, 'utf8').matchAll(/notices\.show\(\s*'([a-z_]+)'/g))
				used.add(match[1] as string);
		expect(used.size).toBeGreaterThan(5);
		expect([...used].filter((key) => !(key in NOTICE_CATALOG))).toEqual([]);
	});
});
