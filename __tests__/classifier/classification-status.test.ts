import { describe, expect, it } from 'vitest';
import {
	classificationErrorStatus,
	classificationNoticeKey,
	CLASSIFICATION_MESSAGES,
} from '../../src/ui/classification-status';
import { JevClassificationError } from '../../src/ui/JevClassifier';
import { HttpError } from '../../src/ui/request';

describe('classification error statuses', () => {
	it('distinguishes missing config, auth, network and server failures', () => {
		expect(classificationErrorStatus(new JevClassificationError('missing-api-key'))).toBe(
			'missing_api_key'
		);
		expect(classificationErrorStatus(new JevClassificationError('missing-model'))).toBe(
			'missing_model'
		);
		expect(
			classificationErrorStatus(new JevClassificationError('question-context-too-large'))
		).toBe('context_too_large');
		expect(classificationErrorStatus(new HttpError('HTTP_ERROR', 401))).toBe('auth_failed');
		expect(classificationErrorStatus(new HttpError('HTTP_ERROR', 403))).toBe('auth_failed');
		expect(classificationErrorStatus(new HttpError('TRANSPORT_ERROR'))).toBe('network_failed');
		expect(classificationErrorStatus(new HttpError('HTTP_ERROR', 503))).toBe('server_failed');
		expect(classificationErrorStatus(new HttpError('TIMEOUT'))).toBe('timeout');
	});

	it('routes setup problems to the notice with an Open settings action', () => {
		expect(classificationNoticeKey('missing_api_key')).toBe('classification_setup');
		expect(classificationNoticeKey('auth_failed')).toBe('classification_setup');
		expect(classificationNoticeKey('no_refs')).toBe('classification_setup');
		expect(classificationNoticeKey('server_failed')).toBe('classification_status');
		expect(classificationNoticeKey('missing_model')).toBe('classification_setup');
		expect(CLASSIFICATION_MESSAGES.missing_api_key).toBe(
			'Jev API key is missing. Add it in settings. No changes were made.'
		);
	});
});
