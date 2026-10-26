import type { JevSelectionResult } from '../types/jev';
import { stripWikiLink } from './classification-state';
import type { FieldSnapshot } from './classification-state';

export interface GenerationRequest {
	selected: string[];
	excluded: string[];
	minimum: number;
	maximum: number;
}

export type ClassificationResolution =
	| { status: 'ready'; values: string[] }
	| { status: 'no_refs' | 'empty' | 'abstain' | 'below_minimum' | 'selection_failed' };

export async function resolveClassificationValues(input: {
	snapshot: FieldSnapshot;
	candidates: string[];
	existing: string[];
	mayGenerate: boolean;
	select: () => Promise<JevSelectionResult>;
	generate: (request: GenerationRequest) => Promise<string[]>;
}): Promise<ClassificationResolution> {
	let selected: string[] = [];
	let hasCandidates = input.candidates.length > 0;
	if (input.candidates.length > 0) {
		const result = await input.select();
		if (result.status === 'abstain') return { status: 'abstain' };
		if (result.status === 'invalid') return { status: 'selection_failed' };
		if (result.status === 'no-candidates') {
			if (!input.mayGenerate) return { status: 'no_refs' };
			hasCandidates = false;
		}
		if (result.status === 'selected') selected = result.values;
		if (result.status === 'empty' && !input.mayGenerate) return { status: 'empty' };
	} else if (!input.mayGenerate) return { status: 'no_refs' };

	const maximum = input.mayGenerate ? Math.max(0, input.snapshot.maximum - selected.length) : 0;
	let generated: string[] = [];
	if (maximum > 0) {
		const excluded = [...input.existing, ...input.candidates, ...selected].map((value) =>
			stripWikiLink(value, input.snapshot.linkType)
		);
		generated = await input.generate({
			selected,
			excluded: [...new Set(excluded)],
			minimum: Math.max(0, input.snapshot.minimum - selected.length),
			maximum,
		});
	}
	const values = [...selected, ...generated];
	if (values.length < input.snapshot.minimum) return { status: 'below_minimum' };
	if (values.length > input.snapshot.maximum) return { status: 'selection_failed' };
	if (values.length === 0) return { status: hasCandidates ? 'empty' : 'no_refs' };
	return { status: 'ready', values };
}
