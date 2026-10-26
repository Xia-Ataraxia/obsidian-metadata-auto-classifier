import { getFrontMatterInfo } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { FrontmatterField } from '../types';
import { editFrontmatterField, FrontmatterEditError } from '../domain/frontmatter-edit';
import { captureTargetSnapshot } from '../domain/frontmatter-snapshot';
import type { TargetFieldSnapshot } from '../domain/frontmatter-snapshot';
import { sameTargetSnapshot } from '../domain/frontmatter-snapshot';

export interface FrontmatterFieldBaseline {
	readonly fieldName: string;
	readonly body: string;
	readonly target: TargetFieldSnapshot;
}

export interface CommitFieldPlan {
	fieldName: string;
	values: string[];
	overwrite: boolean;
	linkType: FrontmatterField['linkType'];
	assertCurrent: () => void;
}

export type FrontmatterCommitErrorReason =
	| 'invalid-field-name'
	| 'invalid-frontmatter-boundary'
	| 'body-conflict'
	| 'target-conflict'
	| 'field-mismatch'
	| 'process-failed';

export class FrontmatterCommitError extends Error {
	constructor(readonly reason: FrontmatterCommitErrorReason) {
		super('Frontmatter commit could not be completed safely');
		this.name = 'FrontmatterCommitError';
	}
}

interface ContentParts {
	bom: string;
	hasFrontmatter: boolean;
	beforeYaml: string;
	yaml: string;
	afterYaml: string;
	body: string;
}

function splitContent(content: string): ContentParts {
	const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
	const offset = bom.length;
	const info = getFrontMatterInfo(content.slice(offset));
	if (!info.exists) {
		return {
			bom,
			hasFrontmatter: false,
			beforeYaml: '',
			yaml: '',
			afterYaml: '',
			body: content.slice(offset),
		};
	}

	const from = info.from + offset;
	const to = info.to + offset;
	const bodyStart = info.contentStart + offset;
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		!Number.isInteger(bodyStart) ||
		from < offset ||
		to < from ||
		bodyStart < to ||
		bodyStart > content.length
	) {
		throw new FrontmatterCommitError('invalid-frontmatter-boundary');
	}
	return {
		bom,
		hasFrontmatter: true,
		beforeYaml: content.slice(offset, from),
		yaml: content.slice(from, to),
		afterYaml: content.slice(to, bodyStart),
		body: content.slice(bodyStart),
	};
}

function lineEnding(content: string): string {
	return content.match(/\r\n|\r|\n/)?.[0] ?? '\n';
}

function composeContent(parts: ContentParts, yaml: string): string {
	if (parts.hasFrontmatter) {
		const separated = /(?:\r\n|\r|\n)$/.test(yaml)
			? yaml
			: yaml + lineEnding(parts.beforeYaml + parts.afterYaml);
		return parts.bom + parts.beforeYaml + separated + parts.afterYaml + parts.body;
	}
	const eol = lineEnding(parts.body);
	return `${parts.bom}---${eol}${yaml}${eol}---${eol}${parts.body}`;
}

export function captureFieldBaseline(content: string, fieldName: string): FrontmatterFieldBaseline {
	if (!fieldName || /[\r\n]/.test(fieldName))
		throw new FrontmatterCommitError('invalid-field-name');
	const parts = splitContent(content);
	const target = captureTargetSnapshot(parts.yaml, fieldName);
	Object.freeze(target);
	return Object.freeze({ fieldName, body: parts.body, target });
}

export async function commitField(
	app: App,
	file: TFile,
	baseline: FrontmatterFieldBaseline,
	plan: CommitFieldPlan
): Promise<void> {
	let callbackFailed = false;
	let callbackError: unknown;
	try {
		await app.vault.process(file, (current) => {
			try {
				plan.assertCurrent();
				if (plan.fieldName !== baseline.fieldName)
					throw new FrontmatterCommitError('field-mismatch');
				const parts = splitContent(current);
				if (parts.body !== baseline.body) throw new FrontmatterCommitError('body-conflict');
				const currentTarget = captureTargetSnapshot(parts.yaml, baseline.fieldName);
				if (!sameTargetSnapshot(currentTarget, baseline.target))
					throw new FrontmatterCommitError('target-conflict');
				const yaml = editFrontmatterField(parts.yaml, plan.fieldName, plan.values, {
					overwrite: plan.overwrite,
					linkType: plan.linkType,
				});
				return composeContent(parts, yaml);
			} catch (error) {
				callbackFailed = true;
				callbackError = error;
				throw error;
			}
		});
	} catch (error) {
		if (callbackFailed) throw callbackError;
		if (error instanceof FrontmatterEditError) throw error;
		throw new FrontmatterCommitError('process-failed');
	}
}
