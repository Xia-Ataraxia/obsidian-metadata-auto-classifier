import { replaceFrontmatterById } from '../../src/utils/lib-utils';
import type { FrontmatterField } from '../../src/types';

const field = (id: number, name: string): FrontmatterField => ({
	id,
	name,
	count: { min: 1, max: 1 },
	refs: [],
	overwrite: false,
	linkType: 'WikiLink',
	customQuery: '',
});

describe('saving an edited frontmatter clone (#47)', () => {
	it('persists a newly added field after the editor changes its clone', () => {
		const list = [field(0, 'tags'), field(42, '')];
		const clone = { ...list[1]! };
		clone.name = 'Personnes';

		const saved = replaceFrontmatterById(list, clone);

		expect(saved.map((f) => f.name)).toEqual(['tags', 'Personnes']);
		expect(list[1]!.name).toBe('');
	});
});
