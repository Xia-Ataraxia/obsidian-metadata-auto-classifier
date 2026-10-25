import type { MetadataCache, TFile } from 'obsidian';
import { getAllTags, parseFrontMatterStringArray } from 'obsidian';

import type { FrontmatterField } from '../types';

/**
 * Collects all unique values for a specific frontmatter field from the vault.
 *
 * @param fieldName - The name of the frontmatter field to collect values for (for example, "tags").
 * @param files - The list of files to scan for the specified frontmatter field.
 * @param metadataCache - The Obsidian metadata cache used to access frontmatter and tags.
 * @returns An array of unique string values found for the specified field across all files.
 */
export function getFieldValues(
	fieldName: string,
	files: ReadonlyArray<TFile>,
	metadataCache: MetadataCache
): string[] {
	const values = new Set<string>();

	for (const file of files) {
		const cache = metadataCache.getFileCache(file);
		if (!cache) continue;

		if (fieldName === 'tags') {
			// tags requires getAllTags() to include inline tags (#tag in content)
			// parseFrontMatterStringArray would only get frontmatter tags
			getAllTags(cache)?.forEach((tag) => values.add(tag));
		} else {
			// Delegate to Obsidian API - handles both single values and arrays
			parseFrontMatterStringArray(cache.frontmatter, fieldName)?.forEach((v) => values.add(v));
		}
	}

	return [...values];
}

/**
 * Creates a deep copy of a FrontmatterField to prevent input mutation.
 * Used when editing frontmatter settings in modals.
 */
export function deepCloneFrontmatterField(field: FrontmatterField): FrontmatterField {
	return {
		id: field.id,
		name: field.name,
		count: { min: field.count.min, max: field.count.max },
		refs: [...field.refs],
		overwrite: field.overwrite,
		linkType: field.linkType,
		customQuery: field.customQuery,
		generateNewTags: field.name === 'tags' && field.generateNewTags === true,
	};
}
