import { describe, expect, it } from 'vitest';
import {
	classificationErrorStatus,
	classificationNoticeKey,
	CLASSIFICATION_MESSAGES,
} from '../../src/ui/classification-status';
import { DecisionClassificationError } from '../../src/ui/DecisionClassifier';
import { HttpError } from '../../src/ui/request';

describe('classification error statuses', () => {
	it('distinguishes oversized notes, auth, network and server failures', () => {
		expect(
			classificationErrorStatus(new DecisionClassificationError('question-context-too-large'))
		).toBe('context_too_large');
		expect(classificationErrorStatus(new DecisionClassificationError('expired'))).toBe('timeout');
		expect(classificationErrorStatus(new HttpError('HTTP_ERROR', 401))).toBe('auth_failed');
		expect(classificationErrorStatus(new HttpError('HTTP_ERROR', 403))).toBe('auth_failed');
		expect(classificationErrorStatus(new HttpError('TRANSPORT_ERROR'))).toBe('network_failed');
		expect(classificationErrorStatus(new HttpError('HTTP_ERROR', 503))).toBe('server_failed');
		expect(classificationErrorStatus(new HttpError('TIMEOUT'))).toBe('timeout');
	});

	it('routes setup problems to the notice with an Open settings action', () => {
		expect(classificationNoticeKey('no_model')).toBe('classification_setup');
		expect(classificationNoticeKey('auth_failed')).toBe('classification_setup');
		expect(classificationNoticeKey('no_refs')).toBe('classification_setup');
		expect(classificationNoticeKey('server_failed')).toBe('classification_status');
		expect(CLASSIFICATION_MESSAGES.no_model).toBe(
			'Add a decision API model in settings to classify. No changes were made.'
		);
	});
});
