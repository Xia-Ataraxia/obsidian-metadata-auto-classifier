import { isAlias, isMap, isScalar, isSeq, parseDocument, stringify, visit } from 'yaml';
import type { Node, ParsedNode, YAMLMap } from 'yaml';
import type { FrontmatterField } from '../types';

export type FrontmatterEditErrorReason =
	| 'invalid-field-name'
	| 'invalid-options'
	| 'invalid-input'
	| 'invalid-yaml'
	| 'multiple-documents'
	| 'non-map-root'
	| 'complex-key'
	| 'duplicate-key'
	| 'unsafe-target-reference'
	| 'unsupported-target-value'
	| 'invalid-node-range'
	| 'unsupported-append-location';

export class FrontmatterEditError extends Error {
	constructor(readonly reason: FrontmatterEditErrorReason) {
		super('Frontmatter YAML could not be edited safely');
		this.name = 'FrontmatterEditError';
	}
}

function fail(reason: FrontmatterEditErrorReason): never {
	throw new FrontmatterEditError(reason);
}

export function parseSource(source: string) {
	try {
		const document = parseDocument(source, { uniqueKeys: true, version: '1.2' });
		const code = document.errors.find(
			(error) => error.code === 'MULTIPLE_DOCS' || error.code === 'DUPLICATE_KEY'
		)?.code;
		if (code === 'MULTIPLE_DOCS') fail('multiple-documents');
		if (code === 'DUPLICATE_KEY') fail('duplicate-key');
		if (document.errors.length || document.warnings.length) fail('invalid-yaml');
		return document;
	} catch (error) {
		if (error instanceof FrontmatterEditError) throw error;
		fail('invalid-yaml');
	}
}

function hasFeature(
	node: Node,
	feature: 'reference' | 'comment',
	allowRootComment = false
): boolean {
	let found = false;
	visit(node, {
		Node: (_key, current) => {
			const trailing =
				current === node &&
				allowRootComment &&
				current.range &&
				current.range[2] > current.range[1];
			found =
				feature === 'reference'
					? isAlias(current) || ('anchor' in current && Boolean(current.anchor))
					: current.commentBefore != null || (current.comment != null && !trailing);
			if (found) return visit.BREAK;
			return undefined;
		},
	});
	return found;
}

function serializeFlow(values: readonly string[]): string {
	return stringify([...values], {
		collectionStyle: 'flow',
		flowCollectionPadding: false,
		lineWidth: -1,
	}).replace(/\n$/, '');
}

function serializeKey(key: string): string {
	const keyText = stringify(key, { lineWidth: -1 }).replace(/\n$/, '');
	if (/[\r\n]/.test(keyText)) return fail('invalid-field-name');
	return keyText;
}

function existingValues(node: ParsedNode): string[] {
	const parsed: unknown = node.toJSON();
	const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
	if (values.some((value) => value !== null && typeof value !== 'string'))
		fail('unsupported-target-value');
	return values.filter((value): value is string => typeof value === 'string' && Boolean(value));
}

function lineEnding(source: string, before: number): string {
	const last = Math.max(source.lastIndexOf('\n', before - 1), source.lastIndexOf('\r', before - 1));
	if (last >= 0) return source.slice(last - 1, last + 1) === '\r\n' ? '\r\n' : source.charAt(last);
	return source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
}

function appendEmptySource(source: string, entry: string): string {
	const eol = lineEnding(source, source.length);
	const terminated = /(?:\r\n|\r|\n)$/.test(source);
	return source + (source && !terminated ? eol : '') + entry + (terminated ? eol : '');
}

function appendMissingField(
	source: string,
	root: YAMLMap<ParsedNode, ParsedNode | null>,
	fieldText: string,
	valueText: string
): string {
	if (!root.range || root.range[1] > source.length) fail('invalid-node-range');
	const entry = `${fieldText}: ${valueText}`;
	if (root.flow) {
		const close = root.range[1] - 1;
		const lastPair = root.items[root.items.length - 1];
		if (
			close < root.range[0] ||
			source[close] !== '}' ||
			hasFeature(root, 'comment') ||
			(lastPair && !lastPair.value)
		)
			fail('unsupported-append-location');
		const insertionBase = lastPair?.value?.range?.[2] ?? root.range[0] + 1;
		const gap = source.slice(insertionBase, close);
		if (!/^[\t \r\n]*,?[\t \r\n]*$/.test(gap)) fail('unsupported-append-location');
		const addition = root.items.length && !gap.includes(',') ? `, ${entry}` : entry;
		return source.slice(0, close) + addition + source.slice(close);
	}

	const position = root.range[1];
	const keyStart = root.items[0]?.key.range?.[0];
	if (keyStart == null) fail('unsupported-append-location');
	const lineStart =
		Math.max(source.lastIndexOf('\n', keyStart - 1), source.lastIndexOf('\r', keyStart - 1)) + 1;
	let indent = source.slice(lineStart, keyStart);
	if (lineStart === 0 && indent.startsWith('\uFEFF')) indent = indent.slice(1);
	if (!/^[\t ]*$/.test(indent)) fail('unsupported-append-location');
	const eol = lineEnding(source, position);
	const prefix =
		position === 0 || source[position - 1] === '\n' || source[position - 1] === '\r' ? '' : eol;
	const suffix = source.slice(position);
	const suffixEol = suffix.length > 0 || /(?:\r\n|\r|\n)$/.test(source) ? eol : '';
	return source.slice(0, position) + prefix + indent + entry + suffixEol + suffix;
}

function verifyEditedSource(source: string, fieldName: string, values: readonly string[]): void {
	const target: unknown = parseSource(source).get(fieldName, true);
	const actual: unknown = isSeq(target) ? target.toJSON() : undefined;
	if (JSON.stringify(actual) !== JSON.stringify(values)) fail('invalid-yaml');
}

/** Edit one top-level YAML field while leaving all bytes outside its value range untouched. */
export function editFrontmatterField(
	source: string,
	fieldName: string,
	incomingValues: readonly string[],
	options: { overwrite: boolean; linkType: FrontmatterField['linkType'] }
): string {
	if (!fieldName || /[\r\n]/.test(fieldName)) return fail('invalid-field-name');
	if (
		!options ||
		typeof options.overwrite !== 'boolean' ||
		!['WikiLink', 'Normal'].includes(options.linkType)
	)
		fail('invalid-options');
	if (!Array.isArray(incomingValues) || incomingValues.some((value) => typeof value !== 'string'))
		fail('invalid-input');

	const root = parseSource(source).contents;
	const incoming = incomingValues.map((value: string) =>
		options.linkType === 'WikiLink' ? `[[${value}]]` : value
	);
	let values = [...new Set(incoming)].filter(Boolean);
	let edited: string;
	if (root == null) {
		edited = appendEmptySource(source, `${serializeKey(fieldName)}: ${serializeFlow(values)}`);
	} else {
		if (!isMap<ParsedNode, ParsedNode | null>(root) || root.tag) fail('non-map-root');
		let target: (typeof root.items)[number] | undefined;
		for (const pair of root.items) {
			if (
				!isScalar(pair.key) ||
				typeof pair.key.value !== 'string' ||
				pair.key.anchor ||
				(pair.key.tag && pair.key.tag !== 'tag:yaml.org,2002:str')
			)
				fail('complex-key');
			if (pair.key.value === fieldName) target = pair;
		}
		if (!target)
			edited = appendMissingField(source, root, serializeKey(fieldName), serializeFlow(values));
		else {
			const node = target.value;
			if (!node) return fail('unsupported-target-value');
			if (hasFeature(node, 'reference')) return fail('unsafe-target-reference');
			if ((!isScalar(node) && !isSeq(node)) || hasFeature(node, 'comment', true))
				return fail('unsupported-target-value');
			if (!options.overwrite)
				values = [...new Set([...existingValues(node), ...incoming])].filter(Boolean);
			const range = node.range;
			if (!range || range[0] < 0 || range[1] < range[0] || range[1] > source.length)
				fail('invalid-node-range');
			const [start, end] = range;
			const replaced = source.slice(start, end);
			const separatorBefore = start === end && source[start - 1] === ':' ? ' ' : '';
			const separatorAfter =
				start === end && node.comment != null && source[end] === '#' ? ' ' : '';
			const replacement =
				separatorBefore +
				serializeFlow(values) +
				separatorAfter +
				(replaced.match(/(?:\r\n|\r|\n)+$/)?.[0] ?? '');
			edited = source.slice(0, start) + replacement + source.slice(end);
		}
	}

	verifyEditedSource(edited, fieldName, values);
	return edited;
}
