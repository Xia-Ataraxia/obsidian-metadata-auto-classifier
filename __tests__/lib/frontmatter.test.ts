import { getFieldValues } from '../../src/ui/frontmatter';
import { getAllTags, parseFrontMatterStringArray, type TFile } from 'obsidian';
import {
	createMetadataCacheFixture,
	createTestTFile,
	type MetadataCacheFixture,
} from '../helpers/obsidian-fixtures';

describe('getFieldValues', () => {
	let metadataCache: MetadataCacheFixture;
	let file1: TFile;
	let file2: TFile;
	let file3: TFile;

	beforeEach(() => {
		vi.clearAllMocks();
		metadataCache = createMetadataCacheFixture();
		file1 = createTestTFile('note1.md', 'note1');
		file2 = createTestTFile('note2.md', 'note2');
		file3 = createTestTFile('note3.md', 'note3');
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

		expect(
			getFieldValues('category', [file1, file2, file3], metadataCache.metadataCache)
		).toEqual([
			'tech',
			'programming',
			'design',
		]);
		expect(parseFrontMatterStringArray).toHaveBeenCalledTimes(3);
		expect(getAllTags).not.toHaveBeenCalled();
	});

	test('collects frontmatter and inline tags through getAllTags without the leading #', () => {
		metadataCache.setFileCache(file1, {
			frontmatter: { tags: ['#frontmatter', '#shared'] },
			tags: [{ tag: '#inline' }, { tag: '#shared' }],
		});
		metadataCache.setFileCache(file2, {
			frontmatter: { tags: '#another' },
			tags: [{ tag: '#shared' }],
		});

		expect(getFieldValues('tags', [file1, file2], metadataCache.metadataCache)).toEqual([
			'frontmatter',
			'shared',
			'inline',
			'another',
		]);
		expect(getAllTags).toHaveBeenCalledTimes(2);
		expect(parseFrontMatterStringArray).not.toHaveBeenCalled();
	});

	test('skips files without cached metadata and fields without values', () => {
		metadataCache.setFileCache(file1, { frontmatter: { category: 'tech' } });
		metadataCache.setFileCache(file2, { frontmatter: { other: 'value' } });

		expect(
			getFieldValues('category', [file1, file2, file3], metadataCache.metadataCache)
		).toEqual(['tech']);
		expect(metadataCache.metadataCache.getFileCache).toHaveBeenCalledTimes(3);
	});
});
