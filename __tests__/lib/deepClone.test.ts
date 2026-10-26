import { deepCloneFrontmatterField } from '../../src/ui/frontmatter';
import type { FrontmatterField } from '../../src/types';

describe('deepCloneFrontmatterField', () => {
	const createTestField = (): FrontmatterField => ({
		id: 123,
		name: 'test-field',
		count: { min: 1, max: 5 },
		refs: ['ref1', 'ref2'],
		overwrite: true,
		linkType: 'WikiLink',
		customQuery: 'custom query',
	});

	it('preserves field values and defaults generation permission to false', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		expect(cloned).toEqual({ ...original, generateNewTags: false });
	});

	it('should not be the same reference as original', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		expect(cloned).not.toBe(original);
	});

	it('should create a new count object', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		expect(cloned.count).not.toBe(original.count);
		expect(cloned.count).toEqual(original.count);
	});

	it('should create a new refs array', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		expect(cloned.refs).not.toBe(original.refs);
		expect(cloned.refs).toEqual(original.refs);
	});

	it('should not mutate original when modifying cloned count', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		cloned.count.min = 10;
		cloned.count.max = 20;

		expect(original.count.min).toBe(1);
		expect(original.count.max).toBe(5);
	});

	it('should not mutate original when modifying cloned refs', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		cloned.refs.push('new-ref');
		cloned.refs[0] = 'modified';

		expect(original.refs).toEqual(['ref1', 'ref2']);
	});

	it('should not mutate original when modifying cloned primitive fields', () => {
		const original = createTestField();
		const cloned = deepCloneFrontmatterField(original);

		cloned.name = 'modified-name';
		cloned.overwrite = false;
		cloned.linkType = 'Normal';
		cloned.customQuery = 'modified query';

		expect(original.name).toBe('test-field');
		expect(original.overwrite).toBe(true);
		expect(original.linkType).toBe('WikiLink');
		expect(original.customQuery).toBe('custom query');
	});

	it('should handle empty refs array', () => {
		const original: FrontmatterField = {
			...createTestField(),
			refs: [],
		};
		const cloned = deepCloneFrontmatterField(original);

		expect(cloned.refs).toEqual([]);
		expect(cloned.refs).not.toBe(original.refs);
	});

	it('should handle empty customQuery', () => {
		const original: FrontmatterField = {
			...createTestField(),
			customQuery: '',
		};
		const cloned = deepCloneFrontmatterField(original);

		expect(cloned.customQuery).toBe('');
	});
});
