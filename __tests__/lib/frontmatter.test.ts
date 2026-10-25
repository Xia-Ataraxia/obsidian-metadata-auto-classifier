import { getFieldValues } from 'lib/frontmatter';
import { createMockTFile, getAllTags, MetadataCache, parseFrontMatterStringArray } from 'obsidian';

describe('getFieldValues', () => {
	let metadataCache: MetadataCache;
	let file1: ReturnType<typeof createMockTFile>;
	let file2: ReturnType<typeof createMockTFile>;
	let file3: ReturnType<typeof createMockTFile>;

	beforeEach(() => {
		vi.clearAllMocks();
		metadataCache = new MetadataCache();
		file1 = createMockTFile('note1.md', 'note1');
		file2 = createMockTFile('note2.md', 'note2');
		file3 = createMockTFile('note3.md', 'note3');
	});

	test('collects unique values for a regular frontmatter field', () => {
		metadataCache.setFileCache(file1, {
			frontmatter: { category: ['tech', 'programming'] },
		});
		metadataCache.setFileCache(file2, {
			frontmatter: { category: ['tech', 'design'] },
		});
		metadataCache.setFileCache(file3, {
			frontmatter: { category: 'programming' },
		});

		expect(getFieldValues('category', [file1, file2, file3], metadataCache)).toEqual([
			'tech',
			'programming',
			'design',
		]);
		expect(parseFrontMatterStringArray).toHaveBeenCalledTimes(3);
		expect(getAllTags).not.toHaveBeenCalled();
	});

	test('collects frontmatter and inline tags through getAllTags', () => {
		metadataCache.setFileCache(file1, {
			frontmatter: { tags: ['#frontmatter', '#shared'] },
			tags: [{ tag: '#inline' }, { tag: '#shared' }],
		});
		metadataCache.setFileCache(file2, {
			frontmatter: { tags: '#another' },
			tags: [{ tag: '#shared' }],
		});

		expect(getFieldValues('tags', [file1, file2], metadataCache)).toEqual([
			'#frontmatter',
			'#shared',
			'#inline',
			'#another',
		]);
		expect(getAllTags).toHaveBeenCalledTimes(2);
		expect(parseFrontMatterStringArray).not.toHaveBeenCalled();
	});

	test('skips files without cached metadata and fields without values', () => {
		metadataCache.setFileCache(file1, { frontmatter: { category: 'tech' } });
		metadataCache.setFileCache(file2, { frontmatter: { other: 'value' } });

		expect(getFieldValues('category', [file1, file2, file3], metadataCache)).toEqual(['tech']);
		expect(metadataCache.getFileCache).toHaveBeenCalledTimes(3);
	});
});
