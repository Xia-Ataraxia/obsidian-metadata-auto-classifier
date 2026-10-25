import { isAlias, isMap, isScalar, isSeq, visit } from 'yaml';
import type { Node, ParsedNode } from 'yaml';

import { FrontmatterEditError, parseSource } from './frontmatter-edit';

export type SnapshotScalar = string | number | boolean | null;

export type TargetFieldSnapshot =
	| { present: false; type: 'missing' }
	| { present: true; type: 'scalar'; value: SnapshotScalar }
	| { present: true; type: 'array'; value: readonly SnapshotScalar[] };

function fail(
	reason: 'complex-key' | 'non-map-root' | 'unsafe-target-reference' | 'unsupported-target-value'
): never {
	throw new FrontmatterEditError(reason);
}

function hasReference(node: Node): boolean {
	let found = false;
	visit(node, {
		Node: (_key, current) => {
			found = isAlias(current) || ('anchor' in current && Boolean(current.anchor));
			if (found) return visit.BREAK;
		},
	});
	return found;
}

function readScalar(node: ParsedNode): SnapshotScalar {
	if (!isScalar(node)) return fail('unsupported-target-value');
	const value: unknown = node.value;
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return fail('unsupported-target-value');
}

export function captureTargetSnapshot(source: string, fieldName: string): TargetFieldSnapshot {
	const root = parseSource(source).contents;
	if (root == null) return { present: false, type: 'missing' };
	if (!isMap<ParsedNode, ParsedNode | null>(root) || root.tag || root.anchor)
		return fail('non-map-root');

	let target: (typeof root.items)[number] | undefined;
	for (const pair of root.items) {
		if (
			!isScalar(pair.key) ||
			typeof pair.key.value !== 'string' ||
			pair.key.anchor ||
			(pair.key.tag && pair.key.tag !== 'tag:yaml.org,2002:str')
		)
			return fail('complex-key');
		if (pair.key.value === fieldName) target = pair;
	}
	if (!target) return { present: false, type: 'missing' };
	if (!target.value) return { present: true, type: 'scalar', value: null };
	if (hasReference(target.value)) return fail('unsafe-target-reference');
	if (isSeq(target.value)) {
		const value = target.value.items.map((item) => readScalar(item));
		return { present: true, type: 'array', value: Object.freeze(value) };
	}
	return { present: true, type: 'scalar', value: readScalar(target.value) };
}

export function sameTargetSnapshot(left: TargetFieldSnapshot, right: TargetFieldSnapshot): boolean {
	if (left.present !== right.present || left.type !== right.type) return false;
	if (!left.present || !right.present) return true;
	if (left.type === 'scalar' && right.type === 'scalar') return Object.is(left.value, right.value);
	if (left.type !== 'array' || right.type !== 'array' || left.value.length !== right.value.length)
		return false;
	return left.value.every((value, index) => Object.is(value, right.value[index]));
}
