import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { editFrontmatterField, FrontmatterEditError } from '../../src/domain/frontmatter-edit';
import type { FrontmatterEditErrorReason } from '../../src/domain/frontmatter-edit';

const normal = { overwrite: true, linkType: 'Normal' as const };
const append = { overwrite: false, linkType: 'Normal' as const };

function readValues(source: string, fieldName: string): unknown[] {
	const document = parseDocument(source);
	if (!isMap(document.contents)) throw new Error('Expected a YAML mapping');
	const pair = document.contents.items.find(
		(item) => isScalar(item.key) && item.key.value === fieldName
	);
	if (!pair || !isSeq(pair.value)) throw new Error('Expected a YAML sequence field');
	return pair.value.items.map((item) => (isScalar(item) ? item.value : undefined));
}

function expectReason(action: () => unknown, reason: FrontmatterEditErrorReason): void {
	let caught: unknown;
	try {
		action();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(FrontmatterEditError);
	expect((caught as FrontmatterEditError).reason).toBe(reason);
	expect((caught as Error).message).toBe('Frontmatter YAML could not be edited safely');
}

describe('editFrontmatterField', () => {
	test('replaces only a scalar value and preserves key spelling, comments, EOLs, and unrelated bytes', () => {
		const source =
			"\uFEFF# keep header\r\n\"tags\"  : 'old' # keep target comment\r\nother: { nested: 'quoted' } # keep other\r\n";
		const document = parseDocument(source);
		if (!isMap(document.contents)) throw new Error('Expected a YAML mapping');
		const target = document.contents.items.find(
			(item) => isScalar(item.key) && item.key.value === 'tags'
		);
		if (!target || !isScalar(target.value)) throw new Error('Expected a scalar target');
		const [start, end] = target.value.range ?? [];
		if (start == null || end == null) throw new Error('Expected a public source range');
		const prefix = source.slice(0, start);
		const suffix = source.slice(end);

		const edited = editFrontmatterField(source, 'tags', ['wiki: page', '한글', '[[link]]'], normal);

		expect(edited.slice(0, prefix.length)).toBe(prefix);
		expect(edited.slice(edited.length - suffix.length)).toBe(suffix);
		expect(edited).toContain('"tags"  : ');
		expect(readValues(edited, 'tags')).toEqual(['wiki: page', '한글', '[[link]]']);
	});

	test('appends to a scalar as one value and applies WikiLink formatting without trimming', () => {
		const source = 'category: existing\r\nother: [keep]\r\n';
		const edited = editFrontmatterField(source, 'category', ['two: words', '日本語'], {
			...append,
			linkType: 'WikiLink',
		});

		expect(readValues(edited, 'category')).toEqual(['existing', '[[two: words]]', '[[日本語]]']);
		expect(edited).toContain('\r\nother: [keep]\r\n');
	});

	test('preserves all seven append values in order and deduplicates exact values only', () => {
		const source = 'tags: [one, two, three, " four "]\n';
		const edited = editFrontmatterField(source, 'tags', ['five', 'six', 'seven'], append);

		expect(readValues(edited, 'tags')).toEqual([
			'one',
			'two',
			'three',
			' four ',
			'five',
			'six',
			'seven',
		]);
	});

	test('deduplicates incoming values and removes only empty strings', () => {
		const edited = editFrontmatterField(
			'tags: [old]\n',
			'tags',
			['', ' exact ', 'exact', ' exact ', ''],
			normal
		);

		expect(readValues(edited, 'tags')).toEqual([' exact ', 'exact']);
	});

	test('replaces block sequences without consuming their safe final newline or adjacent comments', () => {
		const source = 'tags:\n  - old\n# preserve this comment\nother: value\n';
		const edited = editFrontmatterField(source, 'tags', ['new'], normal);

		expect(readValues(edited, 'tags')).toEqual(['new']);
		expect(edited).toContain('[new]\n# preserve this comment\nother: value\n');
	});

	test.each([
		['explicit null', 'tags: null\n'],
		['empty value', 'tags:\n'],
		['empty flow sequence', 'tags: []\n'],
	])('supports %s during append', (_label, source) => {
		const edited = editFrontmatterField(source, 'tags', ['new'], append);
		expect(readValues(edited, 'tags')).toEqual(['new']);
	});

	test('inserts the required separator for a zero-width empty value without consuming comments or EOLs', () => {
		const source = 'tags:\r\n# keep comment\r\nother: keep\r\n';
		const edited = editFrontmatterField(source, 'tags', ['new'], append);

		expect(edited).toBe('tags: [new]\r\n# keep comment\r\nother: keep\r\n');
	});

	test('preserves an inline comment after an empty value', () => {
		const source = 'tags: # keep inline comment\nother: keep\n';
		const edited = editFrontmatterField(source, 'tags', ['new'], append);

		expect(edited).toBe('tags: [new] # keep inline comment\nother: keep\n');
	});

	test('keeps original spacing before an inline comment on an empty value', () => {
		const source = 'tags:   # keep inline comment\r\nother: keep\r\n';
		const edited = editFrontmatterField(source, 'tags', ['new'], append);

		expect(edited).toBe('tags:   [new] # keep inline comment\r\nother: keep\r\n');
	});

	test('safely appends a missing key before trailing comments and preserves CRLF and final newline', () => {
		const source = 'title: Test\r\n# trailing comment\r\n';
		const edited = editFrontmatterField(source, 'tags', ['new'], normal);

		expect(edited).toBe('title: Test\r\ntags: [new]\r\n# trailing comment\r\n');
		expect(readValues(edited, 'tags')).toEqual(['new']);
	});

	test('appends a missing key without changing an absent final newline', () => {
		const edited = editFrontmatterField('title: Test', 'tags', ['new'], normal);

		expect(edited).toBe('title: Test\ntags: [new]');
		expect(readValues(edited, 'tags')).toEqual(['new']);
	});

	test.each([
		['empty YAML', '', 'tags: [new]'],
		[
			'comment-only YAML',
			'# preserve this comment\r\n',
			'# preserve this comment\r\ntags: [new]\r\n',
		],
	])('creates a mapping for %s and preserves existing bytes', (_label, source, expected) => {
		const edited = editFrontmatterField(source, 'tags', ['new'], normal);

		expect(edited).toBe(expected);
		expect(readValues(edited, 'tags')).toEqual(['new']);
	});

	test('safely serializes a missing key containing YAML punctuation', () => {
		const edited = editFrontmatterField('title: Test\n', 'name: with colon', ['new'], normal);

		expect(readValues(edited, 'name: with colon')).toEqual(['new']);
	});

	test('appends to a flow mapping using its node range', () => {
		const edited = editFrontmatterField('{ title: Test }', 'tags', ['new'], normal);

		expect(readValues(edited, 'tags')).toEqual(['new']);
	});

	test.each([
		['malformed YAML', 'tags: [broken', 'invalid-yaml'],
		['duplicate keys', 'tags: old\ntags: newer\n', 'duplicate-key'],
		['complex top-level key', '? [one, two]\n: value\n', 'complex-key'],
		['complex key after requested field', 'tags: [old]\n? [one, two]\n: value\n', 'complex-key'],
		['non-map root', 'a scalar root\n', 'non-map-root'],
		['multiple documents', 'first: value\n---\nsecond: value\n', 'multiple-documents'],
		['target anchor', 'tags: &saved [old]\nother: *saved\n', 'unsafe-target-reference'],
		['target alias', 'base: &saved old\ntags: *saved\n', 'unsafe-target-reference'],
		['non-string append item', 'tags: [1]\n', 'unsupported-target-value'],
		[
			'comment inside replaced block value',
			'tags:\n  - old # retain\n',
			'unsupported-target-value',
		],
	] as const)('rejects %s with a safe reason', (_label, source, reason) => {
		expectReason(() => editFrontmatterField(source, 'tags', ['new'], append), reason);
	});
});
