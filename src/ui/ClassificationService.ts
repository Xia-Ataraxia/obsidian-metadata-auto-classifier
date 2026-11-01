import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { AutoClassifierSettings } from '../types';
import {
	ClassificationState,
	ClassificationStateError,
	classificationCandidates,
	existingStringValues,
	findField,
	providerHasAuth,
	sameFieldSnapshot,
	readFieldSnapshot,
	validateCount,
} from '../domain/classification-state';
import type { FieldSnapshot } from '../domain/classification-state';
import { classificationTarget } from '../domain/model-list';
import { resolveClassificationValues } from '../domain/classification-result';
import { isTagGenerationAllowed } from '../domain/tag-generation';
import { commitField, captureFieldBaseline } from './frontmatter-commit';
import { getFieldValues } from './frontmatter';
import { DecisionClassifier } from './DecisionClassifier';
import { createGenerationStage } from './classification-generation';
import { createProviderSession } from './provider-session';
import {
	CLASSIFICATION_MESSAGES,
	ClassificationIssue,
	classificationErrorStatus,
	classificationNoticeKey,
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

// Empty refs fall back to values used in the note's own folder; never scan the whole vault.
function siblingMarkdownFiles(file: TFile): TFile[] {
	return (file.parent?.children ?? [file]).filter(
		(item): item is TFile => item instanceof TFile && item.extension === 'md'
	);
}

export class ClassificationService {
	private readonly state = new ClassificationState();
	private readonly decisions = new DecisionClassifier();

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
		const snapshot = readFieldSnapshot(field, before.classificationRule);
		validateCount(field);
		const assertBase = () => this.assertBase(file, path, fieldId, token, snapshot, deadline);
		assertBase();
		// Folder-local fallback is per run; persisting it would freeze one folder's values as the global list.
		const candidates = classificationCandidates(
			snapshot.refs.length === 0
				? { ...snapshot, refs: this.folderRefs(file, snapshot.name) }
				: snapshot
		);
		const mayGenerate = isTagGenerationAllowed({
			name: snapshot.name,
			generateNewTags: snapshot.generateNewTags,
		});
		if (candidates.length === 0 && !mayGenerate) throw new ClassificationIssue('no_refs');
		const content = await this.context.app.vault.cachedRead(file);
		assertBase();
		const baseline = captureFieldBaseline(content, snapshot.name);
		let session: ReturnType<typeof createProviderSession> | undefined;
		let selected: Pick<AutoClassifierSettings, 'selectedProvider' | 'selectedModel'> | undefined;
		let generated = false;
		const assertSelected = () => {
			assertBase();
			const live = this.context.getSettings();
			if (
				selected &&
				(live.selectedProvider !== selected.selectedProvider ||
					live.selectedModel !== selected.selectedModel)
			)
				throw new ClassificationStateError('provider-changed');
		};
		const assertSelection = () => {
			if (session) session.assertCurrent();
			else assertBase();
		};
		const select = async () => {
			const settings = this.context.getSettings();
			const target = classificationTarget(settings);
			if (!target || !providerHasAuth(target.provider)) throw new ClassificationIssue('no_model');
			selected = { selectedProvider: settings.selectedProvider, selectedModel: settings.selectedModel };
			session = createProviderSession({
				getProvider: () => classificationTarget(this.context.getSettings())?.provider,
				saveSettings: () => this.context.saveSettings(),
				onPersistFailed: () => this.context.notices.show('settings_save_failed'),
				assertCurrent: assertSelected,
			});
			const result = await this.decisions.classify(
				{
					body: baseline.body,
					fieldName: snapshot.name,
					instructions: [snapshot.instructions, snapshot.fieldInstructions]
						.filter(Boolean)
						.join('\n\n'),
					candidates,
					max: snapshot.maximum,
				},
				session.provider,
				target.model,
				{ deadline, assertCurrent: assertSelection, onTokenRefresh: session.refreshTokens }
			);
			assertSelection();
			return result;
		};
		const generation = createGenerationStage({
			getSettings: () => this.context.getSettings(),
			saveSettings: () => this.context.saveSettings(),
			onPersistFailed: () => this.context.notices.show('settings_save_failed'),
			snapshot,
			body: baseline.body,
			deadline,
			// Generation guards its own provider; a token refresh there must not trip the scoring snapshot.
			assertCurrent: assertSelected,
		});
		const resolution = await resolveClassificationValues({
			snapshot,
			candidates,
			existing: existingStringValues(baseline.target),
			mayGenerate,
			select,
			generate: (request) => {
				generated = true;
				return generation.generate(request);
			},
		});
		if (resolution.status !== 'ready') throw new ClassificationIssue(resolution.status);
		await commitField(this.context.app, file, baseline, {
			fieldName: snapshot.name,
			values: resolution.values,
			overwrite: snapshot.overwrite,
			linkType: snapshot.linkType,
			assertCurrent: generated ? generation.assertCurrent : assertSelection,
		});
		this.show('completed');
	}

	private folderRefs(file: TFile, fieldName: string): string[] {
		try {
			return getFieldValues(
				fieldName,
				siblingMarkdownFiles(file),
				this.context.app.metadataCache
			);
		} catch {
			throw new ClassificationIssue('preparation_failed');
		}
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
		this.context.notices.show(classificationNoticeKey(status), {
			message: CLASSIFICATION_MESSAGES[status],
		});
	}
}
