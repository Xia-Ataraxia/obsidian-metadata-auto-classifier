import type { App, TFile } from 'obsidian';
import type { AutoClassifierSettings } from '../types';
import {
	ClassificationState,
	ClassificationStateError,
	classificationCandidates,
	existingStringValues,
	findField,
	sameFieldSnapshot,
	readFieldSnapshot,
	validateCount,
} from '../domain/classification-state';
import type { FieldSnapshot } from '../domain/classification-state';
import { resolveClassificationValues } from '../domain/classification-result';
import { isTagGenerationAllowed } from '../domain/tag-generation';
import { commitField, captureFieldBaseline } from './frontmatter-commit';
import { getFieldValues } from './frontmatter';
import { JevClassifier } from './JevClassifier';
import { createGenerationStage } from './classification-generation';
import {
	CLASSIFICATION_MESSAGES,
	ClassificationIssue,
	classificationErrorStatus,
} from './classification-status';
import type { ClassificationStatus } from './classification-status';
import type { PluginNotices } from './plugin-notices';

export interface ClassificationContext {
	app: App;
	getSettings: () => AutoClassifierSettings;
	isActive: () => boolean;
	saveSettings: () => Promise<void>;
	notices: PluginNotices;
}

const DEADLINE_MS = 60_000;

export class ClassificationService {
	private readonly state = new ClassificationState();
	private readonly jev = new JevClassifier();

	constructor(private readonly context: ClassificationContext) {}

	deactivate(): void {
		this.state.deactivate();
	}

	async classify(file: TFile, fieldId: number): Promise<void> {
		if (!this.context.isActive() || !this.state.isActive()) return;
		if (!findField(this.context.getSettings(), fieldId)) return this.show('invalid_settings');
		const token = this.state.acquire(file, fieldId);
		if (!token) return this.show('busy');
		try {
			await this.run(file, fieldId, token);
		} catch (error) {
			if (this.context.isActive()) this.show(classificationErrorStatus(error));
		} finally {
			this.state.release(file, fieldId, token);
		}
	}

	private async run(file: TFile, fieldId: number, token: symbol): Promise<void> {
		const path = file.path;
		const deadline = Date.now() + DEADLINE_MS;
		const before = this.context.getSettings();
		const field = findField(before, fieldId);
		if (!field) throw new ClassificationIssue('invalid_settings');
		let snapshot = readFieldSnapshot(field, before.classificationRule);
		validateCount(field);
		if (snapshot.refs.length === 0)
			snapshot = await this.prepareRefs(file, path, fieldId, token, snapshot, deadline);
		const assertBase = () => this.assertBase(file, path, fieldId, token, snapshot, deadline);
		assertBase();
		const candidates = classificationCandidates(snapshot);
		const mayGenerate = isTagGenerationAllowed({
			name: snapshot.name,
			generateNewTags: snapshot.generateNewTags,
		});
		if (candidates.length === 0 && !mayGenerate) throw new ClassificationIssue('no_refs');
		const content = await this.context.app.vault.cachedRead(file);
		assertBase();
		const baseline = captureFieldBaseline(content, snapshot.name);
		let jevConfig: AutoClassifierSettings['jev'] | undefined;
		const assertSelection = () => {
			assertBase();
			if (!jevConfig) return;
			const live = this.context.getSettings().jev;
			if (!live || live.apiKey !== jevConfig.apiKey || live.model !== jevConfig.model)
				throw new ClassificationStateError('settings-changed');
		};
		const select = async () => {
			const current = this.context.getSettings().jev;
			if (!current) throw new ClassificationIssue('selection_failed');
			jevConfig = { ...current };
			const result = await this.jev.classify(
				{
					body: baseline.body,
					fieldName: snapshot.name,
					instructions: [snapshot.instructions, snapshot.fieldInstructions]
						.filter(Boolean)
						.join('\n\n'),
					candidates,
					max: snapshot.maximum,
				},
				jevConfig,
				{ deadline, assertCurrent: assertSelection }
			);
			assertSelection();
			return result;
		};
		const generation = createGenerationStage({
			getSettings: () => this.context.getSettings(),
			saveSettings: () => this.context.saveSettings(),
			snapshot,
			body: baseline.body,
			deadline,
			assertCurrent: assertSelection,
		});
		const resolution = await resolveClassificationValues({
			snapshot,
			candidates,
			existing: existingStringValues(baseline.target),
			mayGenerate,
			select,
			generate: generation.generate,
		});
		if (resolution.status !== 'ready') throw new ClassificationIssue(resolution.status);
		await commitField(this.context.app, file, baseline, {
			fieldName: snapshot.name,
			values: resolution.values,
			overwrite: snapshot.overwrite,
			linkType: snapshot.linkType,
			assertCurrent: generation.assertCurrent,
		});
		this.show('completed');
	}

	private async prepareRefs(
		file: TFile,
		path: string,
		id: number,
		token: symbol,
		initial: FieldSnapshot,
		deadline: number
	): Promise<FieldSnapshot> {
		let values: string[];
		try {
			values = getFieldValues(
				initial.name,
				this.context.app.vault.getMarkdownFiles(),
				this.context.app.metadataCache
			);
		} catch {
			throw new ClassificationIssue('preparation_failed');
		}
		this.assertBase(file, path, id, token, initial, deadline);
		const beforeSave = this.context.getSettings();
		const liveField = findField(beforeSave, id);
		if (!liveField || !sameFieldSnapshot(liveField, initial, beforeSave.classificationRule))
			throw new ClassificationStateError('field-changed');
		liveField.refs = [...values];
		const prepared = readFieldSnapshot(liveField, beforeSave.classificationRule);
		this.assertBase(file, path, id, token, prepared, deadline);
		try {
			await this.context.saveSettings();
		} catch {
			const failed = this.context.getSettings();
			const failedField = findField(failed, id);
			if (failedField && sameFieldSnapshot(failedField, prepared, failed.classificationRule))
				failedField.refs = [...initial.refs];
			throw new ClassificationIssue('preparation_failed');
		}
		this.assertBase(file, path, id, token, prepared, deadline);
		return prepared;
	}

	private assertBase(
		file: TFile,
		path: string,
		id: number,
		token: symbol,
		snapshot: FieldSnapshot,
		deadline: number
	): void {
		if (Date.now() >= deadline) throw new ClassificationStateError('operation-expired');
		if (!this.context.isActive() || !this.state.owns(file, id, token))
			throw new ClassificationStateError('operation-revoked');
		if (file.path !== path || this.context.app.vault.getAbstractFileByPath(path) !== file)
			throw new ClassificationStateError('file-changed');
		const settings = this.context.getSettings();
		if (!sameFieldSnapshot(findField(settings, id), snapshot, settings.classificationRule))
			throw new ClassificationStateError('field-changed');
	}

	private show(status: ClassificationStatus): void {
		this.context.notices.show('classification_status', {
			message: CLASSIFICATION_MESSAGES[status],
		});
	}
}
