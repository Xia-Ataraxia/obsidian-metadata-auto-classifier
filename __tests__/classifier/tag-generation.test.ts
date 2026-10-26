import {
	buildTagGenerationPrompt,
	generationSlots,
	isTagGenerationAllowed,
	parseGeneratedTags,
	TagGenerationError,
	validateGeneratedTags,
} from '../../src/domain/tag-generation';

function expectTagError(action: () => unknown, code: string): void {
	let caught: unknown;
	try {
		action();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(TagGenerationError);
	expect((caught as TagGenerationError).code).toBe(code);
	expect((caught as Error).message).toBe('Generated tags could not be validated safely');
}

describe('isTagGenerationAllowed', () => {
	test.each([
		[{ name: 'tags', generateNewTags: true }, true],
		[{ name: 'tags', generateNewTags: false }, false],
		[{ name: 'tags' }, false],
		[{ name: 'tags', generateNewTags: 'true' }, false],
		[{ name: 'tags', generateNewTags: 1 }, false],
		[{ name: 'Tags', generateNewTags: true }, false],
		[{ name: 'tag', generateNewTags: true }, false],
		[{ name: ' tags', generateNewTags: true }, false],
	])('requires exact field name and literal true: %j', (field, expected) => {
		expect(isTagGenerationAllowed(field)).toBe(expected);
	});
});

describe('generationSlots', () => {
	test.each([
		[0, 0, 0],
		[1, 0, 1],
		[5, 4, 1],
		[5, 5, 0],
		[5, 8, 0],
	])('computes slots for max %i and selected %i', (maximum, selected, expected) => {
		expect(generationSlots(maximum, selected)).toBe(expected);
	});

	test.each([
		[-1, 0],
		[0, -1],
		[1.5, 0],
		[0, 2.1],
		[Number.NaN, 0],
		[Infinity, 1],
	])('rejects invalid counts %j', (maximum, selected) => {
		expectTagError(() => generationSlots(maximum, selected), 'invalid-count');
	});
});

describe('parseGeneratedTags', () => {
	test('accepts only an own tags property containing strings, including empty output', () => {
		expect(parseGeneratedTags({ tags: ['topic', 'nested/value'] })).toEqual({
			tags: ['topic', 'nested/value'],
		});
		expect(parseGeneratedTags({ tags: [] })).toEqual({ tags: [] });
	});

	test.each([
		null,
		[],
		'tags',
		{},
		{ tags: 'topic' },
		{ tags: ['topic', 3] },
		{ tags: ['topic'], reliability: 1 },
		{ tags: ['topic'], output: ['other'] },
	])('rejects malformed response shape without exposing it: %j', (response) => {
		expectTagError(() => parseGeneratedTags(response), 'invalid-response');
	});

	test('requires an own property and rejects symbol extras', () => {
		const inherited = Object.create({ tags: ['topic'] }) as object;
		expectTagError(() => parseGeneratedTags(inherited), 'invalid-response');
		const withSymbol = { tags: ['topic'], [Symbol('extra')]: true };
		expectTagError(() => parseGeneratedTags(withSymbol), 'invalid-response');
		const sparseTags = new Array<string>(1);
		expectTagError(() => parseGeneratedTags({ tags: sparseTags }), 'invalid-response');
	});
});

describe('validateGeneratedTags', () => {
	test('accepts Unicode, emoji, numeric-mixed, underscore, hyphen, and nested values unchanged', () => {
		const generated = [
			'日本語',
			'café',
			'💡',
			'👩‍💻',
			'y1984',
			'snake_case',
			'kebab-case',
			'parent/child',
		];
		expect(validateGeneratedTags(generated, [], generated.length)).toEqual(generated);
	});

	test('allows an empty result with no remaining capacity', () => {
		expect(validateGeneratedTags([], [], 0)).toEqual([]);
	});

	test.each([
		['', 'invalid-tag'],
		['  ', 'invalid-tag'],
		[' tag', 'invalid-tag'],
		['tag ', 'invalid-tag'],
		['tag name', 'invalid-tag'],
		['tag\tname', 'invalid-tag'],
		['tag\u00a0name', 'invalid-tag'],
		['#newtag', 'invalid-tag'],
		['1984', 'invalid-tag'],
		['١٢٣', 'invalid-tag'],
		['/tag', 'invalid-tag'],
		['tag/', 'invalid-tag'],
		['a//b', 'invalid-tag'],
		['tag.name', 'invalid-tag'],
	])('rejects invalid syntax %j', (tag, code) => {
		expectTagError(() => validateGeneratedTags([tag], [], 2), code);
	});

	test('rejects case-insensitive generated duplicates without normalizing output', () => {
		expectTagError(() => validateGeneratedTags(['Topic', 'topic'], [], 2), 'duplicate-tag');
		expect(validateGeneratedTags(['Topic'], [], 1)).toEqual(['Topic']);
	});

	test.each([
		['Topic', ['topic']],
		['topic', ['#Topic']],
		['topic', ['stored', '#TOPIC']],
	])(
		'rejects generated tags already excluded, comparing case-insensitively: %s',
		(tag, excluded) => {
			expectTagError(() => validateGeneratedTags([tag], excluded, 1), 'excluded-tag');
		}
	);

	test('excludes references, selected values, and stored tags using only case folding and a leading-hash comparison', () => {
		const excluded = ['#Reference/Value', 'Selected', 'Stored'];
		expectTagError(() => validateGeneratedTags(['reference/value'], excluded, 3), 'excluded-tag');
		expectTagError(() => validateGeneratedTags(['selected'], excluded, 3), 'excluded-tag');
		expectTagError(() => validateGeneratedTags(['stored'], excluded, 3), 'excluded-tag');
	});

	test('rejects the whole result when it exceeds the remaining maximum', () => {
		expectTagError(() => validateGeneratedTags(['one', 'two'], [], 1), 'too-many-tags');
		expect(validateGeneratedTags(['one', 'two'], [], 2)).toEqual(['one', 'two']);
	});

	test('rejects malformed arrays and invalid remaining counts safely', () => {
		expectTagError(
			() => validateGeneratedTags(['one', 'two'] as string[], ['one', 3] as unknown as string[], 2),
			'invalid-response'
		);
		expectTagError(() => validateGeneratedTags(['one'], [], -1), 'invalid-count');
	});
});

describe('buildTagGenerationPrompt', () => {
	test('preserves body and instructions verbatim in JSON context and requests only tags output', () => {
		const body = 'Line 1\r\n"quote"  ';
		const instructions = '  Keep exact casing.\nIgnore no user constraints.  ';
		const prompt = buildTagGenerationPrompt({
			body,
			instructions,
			excluded: ['Existing/Tag', '#stored'],
			minimum: 0,
			maximum: 3,
		});
		const contextMarker = 'Context JSON (body and instructions are preserved as data):\n';
		const context = JSON.parse(
			prompt.slice(prompt.indexOf(contextMarker) + contextMarker.length)
		) as {
			body: string;
			instructions: string;
			excluded: string[];
		};
		expect(context).toEqual({ body, instructions, excluded: ['Existing/Tag', '#stored'] });
		expect(prompt).toContain('"tags": string[]');
		expect(prompt).toContain('empty list is allowed');
	});

	test('rejects invalid count ranges with safe typed errors', () => {
		expectTagError(
			() =>
				buildTagGenerationPrompt({
					body: '',
					instructions: '',
					excluded: [],
					minimum: 2,
					maximum: 1,
				}),
			'invalid-count'
		);
	});
});
