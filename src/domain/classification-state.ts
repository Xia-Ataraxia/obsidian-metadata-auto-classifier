import type { FrontmatterField, ProviderConfig } from '../types';
import { PROVIDER_NAMES } from '../utils/lib-utils';
import type { TargetFieldSnapshot } from './frontmatter-snapshot';

export type ClassificationStateErrorCode =
	| 'invalid-field'
	| 'invalid-count'
	| 'field-changed'
	| 'operation-expired'
	| 'operation-revoked'
	| 'file-changed'
	| 'settings-changed'
	| 'provider-changed';

export class ClassificationStateError extends Error {
	constructor(readonly code: ClassificationStateErrorCode) {
		super('Classification state changed before completion');
		this.name = 'ClassificationStateError';
	}
}

export interface FieldSnapshot {
	readonly id: number;
	readonly name: string;
	readonly refs: readonly string[];
	readonly minimum: number;
	readonly maximum: number;
	readonly overwrite: boolean;
	readonly linkType: FrontmatterField['linkType'];
	readonly fieldInstructions: string;
	readonly instructions: string;
	readonly generateNewTags: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCredentialString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function hasApiKey(value: unknown, optional: boolean): boolean {
	if (value === undefined) return optional;
	return typeof value === 'string' && (optional || value.trim().length > 0);
}

function hasOAuthCredential(value: unknown): boolean {
	return (
		isRecord(value) &&
		hasCredentialString(value.accessToken) &&
		hasCredentialString(value.refreshToken) &&
		hasCredentialString(value.accountId) &&
		typeof value.expiresAt === 'number' &&
		Number.isFinite(value.expiresAt)
	);
}

export function findField(
	settings: { frontmatter: FrontmatterField[] },
	id: number
): FrontmatterField | undefined {
	return settings.frontmatter.find((field) => field.id === id);
}

export function copyProvider(provider: ProviderConfig): ProviderConfig {
	const copied: ProviderConfig = {
		...provider,
		models: provider.models.map((model) => ({ ...model })),
		oauth: provider.oauth ? { ...provider.oauth } : undefined,
	};
	if (provider.auth !== undefined) {
		const auth: unknown = provider.auth;
		if (Array.isArray(auth)) {
			copied.auth = auth.slice() as unknown as ProviderConfig['auth'];
		} else if (isRecord(auth)) {
			const authCopy = { ...auth };
			if (isRecord(auth.oauth)) authCopy.oauth = { ...auth.oauth };
			copied.auth = authCopy as ProviderConfig['auth'];
		} else {
			copied.auth = auth as ProviderConfig['auth'];
		}
	}
	return copied;
}

export function sameProvider(left: ProviderConfig | undefined, right: ProviderConfig): boolean {
	try {
		return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
	} catch {
		return false;
	}
}

export function providerHasAuth(provider: ProviderConfig): boolean {
	if (!Object.values(PROVIDER_NAMES).includes(provider.name)) return false;
	const optionalKey =
		provider.name === PROVIDER_NAMES.OLLAMA || provider.name === PROVIDER_NAMES.LMSTUDIO;
	const expectedAuth = provider.name === PROVIDER_NAMES.CODEX ? 'oauth' : 'apiKey';
	if (provider.auth !== undefined) {
		const auth: unknown = provider.auth;
		if (!isRecord(auth) || auth.type !== expectedAuth) {
			return false;
		}
		return expectedAuth === 'oauth'
			? hasOAuthCredential(auth.oauth)
			: hasApiKey(auth.apiKey, false) || (optionalKey && typeof auth.apiKey === 'string');
	}
	if (provider.authType !== undefined && provider.authType !== expectedAuth) return false;
	return expectedAuth === 'oauth'
		? hasOAuthCredential(provider.oauth)
		: hasApiKey(provider.apiKey, optionalKey);
}

export function existingStringValues(target: TargetFieldSnapshot): string[] {
	if (!target.present) return [];
	const values = target.type === 'array' ? target.value : [target.value];
	if (values.some((value) => value !== null && typeof value !== 'string'))
		throw new ClassificationStateError('invalid-field');
	return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function stripWikiLink(value: string, linkType: FrontmatterField['linkType']): string {
	return linkType === 'WikiLink' && value.startsWith('[[') && value.endsWith(']]')
		? value.slice(2, -2)
		: value;
}

export function readFieldSnapshot(field: FrontmatterField, instructions: string): FieldSnapshot {
	if (
		!field ||
		!Number.isInteger(field.id) ||
		typeof field.name !== 'string' ||
		field.name.trim().length === 0 ||
		/[\r\n]/.test(field.name) ||
		!Array.isArray(field.refs) ||
		field.refs.some((value) => typeof value !== 'string') ||
		!field.count ||
		typeof field.count.min !== 'number' ||
		typeof field.count.max !== 'number' ||
		typeof field.overwrite !== 'boolean' ||
		(field.linkType !== 'WikiLink' && field.linkType !== 'Normal') ||
		typeof field.customQuery !== 'string' ||
		typeof instructions !== 'string'
	)
		throw new ClassificationStateError('invalid-field');
	return Object.freeze({
		id: field.id,
		name: field.name,
		refs: Object.freeze([...field.refs]),
		minimum: field.count.min,
		maximum: field.count.max,
		overwrite: field.overwrite,
		linkType: field.linkType,
		fieldInstructions: field.customQuery,
		instructions,
		generateNewTags: field.name === 'tags' && field.generateNewTags === true,
	});
}

export function sameFieldSnapshot(
	field: FrontmatterField | undefined,
	expected: FieldSnapshot,
	instructions: string
): boolean {
	if (!field) return false;
	try {
		const actual = readFieldSnapshot(field, instructions);
		return (
			actual.id === expected.id &&
			actual.name === expected.name &&
			actual.minimum === expected.minimum &&
			actual.maximum === expected.maximum &&
			actual.overwrite === expected.overwrite &&
			actual.linkType === expected.linkType &&
			actual.fieldInstructions === expected.fieldInstructions &&
			actual.instructions === expected.instructions &&
			actual.generateNewTags === expected.generateNewTags &&
			actual.refs.length === expected.refs.length &&
			actual.refs.every((value, index) => value === expected.refs[index])
		);
	} catch {
		return false;
	}
}

export function validateCount(field: Pick<FrontmatterField, 'count'>): void {
	const { min, max } = field.count;
	if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < 1 || min > max)
		throw new ClassificationStateError('invalid-count');
}

export function classificationCandidates(snapshot: FieldSnapshot): string[] {
	const values = snapshot.refs.map((value) => stripWikiLink(value, snapshot.linkType));
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export class ClassificationState {
	private owners = new WeakMap<object, Map<number, symbol>>();
	private active = true;

	isActive(): boolean {
		return this.active;
	}

	acquire(file: object, fieldId: number): symbol | null {
		if (!this.active) return null;
		let fields = this.owners.get(file);
		if (!fields) {
			fields = new Map();
			this.owners.set(file, fields);
		}
		if (fields.has(fieldId)) return null;
		const token = Symbol('classification-owner');
		fields.set(fieldId, token);
		return token;
	}

	owns(file: object, fieldId: number, token: symbol): boolean {
		return this.owners.get(file)?.get(fieldId) === token;
	}

	release(file: object, fieldId: number, token: symbol): void {
		const fields = this.owners.get(file);
		if (fields?.get(fieldId) === token) fields.delete(fieldId);
	}

	deactivate(): void {
		this.active = false;
		this.owners = new WeakMap();
	}
}
