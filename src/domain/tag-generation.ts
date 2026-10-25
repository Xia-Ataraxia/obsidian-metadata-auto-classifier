export type TagGenerationErrorCode =
	| 'invalid-count'
	| 'invalid-prompt-input'
	| 'invalid-response'
	| 'invalid-tag'
	| 'duplicate-tag'
	| 'excluded-tag'
	| 'too-many-tags';

export class TagGenerationError extends Error {
	constructor(readonly code: TagGenerationErrorCode) {
		super('Generated tags could not be validated safely');
		this.name = 'TagGenerationError';
	}
}

export interface BuildTagGenerationPromptInput {
	body: string;
	instructions: string;
	excluded: readonly string[];
	minimum: number;
	maximum: number;
}

const TAG_SEGMENT_PATTERN = /^[\p{L}\p{M}\p{N}\p{S}_\-\u200C\u200D]+$/u;
const NUMERIC_CHARACTER_PATTERN = /^\p{N}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	if (!Array.isArray(value)) return false;
	const items: readonly unknown[] = value;
	for (let index = 0; index < items.length; index += 1) {
		if (!Object.prototype.hasOwnProperty.call(items, index) || typeof items[index] !== 'string')
			return false;
	}
	return true;
}

function fail(code: TagGenerationErrorCode): never {
	throw new TagGenerationError(code);
}

function assertCount(value: number): void {
	if (!Number.isInteger(value) || value < 0) fail('invalid-count');
}

function exclusionKey(value: string): string {
	const withoutLeadingHash = value.startsWith('#') ? value.slice(1) : value;
	return withoutLeadingHash.toLowerCase();
}

function hasValidTagSyntax(value: string): boolean {
	if (value.length === 0 || value.startsWith('#')) return false;
	const segments = value.split('/');
	if (segments.some((segment) => segment.length === 0 || !TAG_SEGMENT_PATTERN.test(segment)))
		return false;
	return [...value].some(
		(character) =>
			character !== '/' &&
			character !== '\u200C' &&
			character !== '\u200D' &&
			!NUMERIC_CHARACTER_PATTERN.test(character)
	);
}

/** Generation is allowed only for the exact tags key and literal opt-in. */
export function isTagGenerationAllowed(field: {
	name: string;
	generateNewTags?: unknown;
}): boolean {
	return (
		typeof field === 'object' &&
		field !== null &&
		field.name === 'tags' &&
		field.generateNewTags === true
	);
}

/** Return the remaining generated-tag capacity after confident selections. */
export function generationSlots(maximum: number, selectedCount: number): number {
	assertCount(maximum);
	assertCount(selectedCount);
	return Math.max(0, maximum - selectedCount);
}

/** Parse only the exact generated-tag response shape; errors contain no response data. */
export function parseGeneratedTags(response: unknown): { tags: string[] } {
	try {
		if (!isRecord(response)) fail('invalid-response');
		const keys = Reflect.ownKeys(response);
		if (keys.length !== 1 || keys[0] !== 'tags') fail('invalid-response');
		const descriptor = Object.getOwnPropertyDescriptor(response, 'tags');
		if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
			fail('invalid-response');
		const tags: unknown = descriptor.value;
		if (!isStringArray(tags)) fail('invalid-response');
		return { tags };
	} catch (error) {
		if (error instanceof TagGenerationError) throw error;
		fail('invalid-response');
	}
}

/** Validate the complete generation result; never trim, filter, or partially accept it. */
export function validateGeneratedTags(
	tags: readonly string[],
	excluded: readonly string[],
	remaining: number
): string[] {
	assertCount(remaining);
	if (!isStringArray(tags) || !isStringArray(excluded)) fail('invalid-response');
	if (tags.length > remaining) fail('too-many-tags');
	const excludedKeys = new Set(excluded.map(exclusionKey));
	const generatedKeys = new Set<string>();
	for (const tag of tags) {
		if (!hasValidTagSyntax(tag)) fail('invalid-tag');
		const key = tag.toLowerCase();
		if (generatedKeys.has(key)) fail('duplicate-tag');
		if (excludedKeys.has(key)) fail('excluded-tag');
		generatedKeys.add(key);
	}
	return [...tags];
}

/** Build the existing-provider prompt with source strings preserved in JSON context. */
export function buildTagGenerationPrompt(input: BuildTagGenerationPromptInput): string {
	if (
		!input ||
		typeof input.body !== 'string' ||
		typeof input.instructions !== 'string' ||
		!isStringArray(input.excluded)
	)
		fail('invalid-prompt-input');
	assertCount(input.minimum);
	assertCount(input.maximum);
	if (input.minimum > input.maximum) fail('invalid-count');
	const context = JSON.stringify({
		body: input.body,
		instructions: input.instructions,
		excluded: input.excluded,
	});
	return [
		'Generate new Obsidian tags supported by the body and user instructions.',
		`Return between ${input.minimum} and ${input.maximum} tags. When minimum is 0, an empty list is allowed.`,
		'Exclude every tag already listed in excluded. Do not include a leading #.',
		'Return only a JSON object with exactly one key and this shape: {"tags": string[]}.',
		'Context JSON (body and instructions are preserved as data):',
		context,
	].join('\n');
}
