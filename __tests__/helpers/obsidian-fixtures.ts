import { MetadataCache, TFile, type CachedMetadata, type PluginManifest, type TagCache } from 'obsidian';
import { vi } from 'vitest';

export const TEST_PLUGIN_MANIFEST: PluginManifest = {
	id: 'test-plugin',
	name: 'Test Plugin',
	author: 'Test author',
	version: '1.0.0',
	minAppVersion: '0.15.0',
	description: 'Test plugin manifest',
};

export function createTestTFile(path: string, basename: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = basename;
	file.name = `${basename}.md`;
	file.extension = 'md';
	return file;
}

type TestMetadataCacheEntry = Pick<CachedMetadata, 'frontmatter'> & {
	tags?: readonly Pick<TagCache, 'tag'>[];
};

export interface MetadataCacheFixture {
	metadataCache: MetadataCache;
	setFileCache(file: TFile, cache: TestMetadataCacheEntry): void;
}

export function createMetadataCacheFixture(): MetadataCacheFixture {
	const metadataCache = new MetadataCache();
	const fileCaches = new Map<TFile, CachedMetadata>();
	vi.spyOn(metadataCache, 'getFileCache').mockImplementation((file) => fileCaches.get(file) ?? null);

	return {
		metadataCache,
		setFileCache(file, cache) {
			const { tags, ...metadata } = cache;
			fileCaches.set(file, {
				...metadata,
				...(tags === undefined
					? {}
					: {
							tags: tags.map((item, index) => ({
								tag: item.tag,
								position: {
									start: { line: 0, col: index, offset: index },
									end: { line: 0, col: index + item.tag.length, offset: index + item.tag.length },
								},
							})),
						}),
			});
		},
	};
}
