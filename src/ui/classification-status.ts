import { ClassificationStateError } from '../domain/classification-state';
import { FrontmatterEditError } from '../domain/frontmatter-edit';
import { TagGenerationError } from '../domain/tag-generation';
import { FrontmatterCommitError } from './frontmatter-commit';
import { JevClassificationError } from './JevClassifier';
import { GenerationFailedError } from './classification-generation';
import { HttpError } from './request';

export const CLASSIFICATION_MESSAGES = {
	busy: 'Classification is already running for this field.',
	completed: 'Classification completed.',
	no_refs: 'No usable reference values were found. No changes were made.',
	empty: 'No matching references were selected. No changes were made.',
	abstain: 'Classification was uncertain. No changes were made.',
	below_minimum: 'The selected values did not meet the minimum. No changes were made.',
	conflict: 'Settings or note content changed. No changes were made.',
	timeout: 'Classification timed out. No changes were made.',
	generation_failed: 'New tags could not be generated safely. No changes were made.',
	selection_failed: 'Classification could not be completed safely. No changes were made.',
	preparation_failed: 'Reference values could not be prepared. No changes were made.',
	write_failed: 'The note could not be updated safely. No changes were made.',
	invalid_settings: 'Classification settings are invalid. No changes were made.',
} as const;
export type ClassificationStatus = keyof typeof CLASSIFICATION_MESSAGES;

export class ClassificationIssue extends Error {
	constructor(readonly status: ClassificationStatus) {
		super(status);
	}
}

export function classificationErrorStatus(error: unknown): ClassificationStatus {
	if (error instanceof ClassificationIssue) return error.status;
	if (error instanceof ClassificationStateError) {
		if (error.code === 'operation-expired') return 'timeout';
		if (error.code === 'invalid-count' || error.code === 'invalid-field') return 'invalid_settings';
		return 'conflict';
	}
	if (error instanceof FrontmatterCommitError)
		return error.reason === 'process-failed' ? 'write_failed' : 'conflict';
	if (error instanceof FrontmatterEditError) return 'write_failed';
	if (error instanceof HttpError && error.code === 'TIMEOUT') return 'timeout';
	if (error instanceof TagGenerationError || error instanceof GenerationFailedError)
		return 'generation_failed';
	if (error instanceof JevClassificationError)
		return error.code === 'expired' ? 'timeout' : 'selection_failed';
	return 'selection_failed';
}
