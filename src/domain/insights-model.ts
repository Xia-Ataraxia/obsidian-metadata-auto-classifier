import type { Model, ProviderConfig } from '../types';
import type { ModelCatalog, ModelMeta } from '../types/insights';
import { decisionTransport } from './decision-formats';
import { resolveModelMeta } from './model-catalog';
import providerPresetsData from './presets.json';

// A typical note, so prices compare on one scale without recording anyone's usage.
export const ASSUMED_INPUT_TOKENS = 2500;
export const ASSUMED_OUTPUT_TOKENS = 120;

// Subscription and local models join the list only once the user has configured them.
const COMPARED_PRESETS = new Set(['OpenAI', 'Anthropic', 'Gemini', 'DeepSeek', 'TypeSafe']);

export interface InsightModel {
	provider: string;
	id: string;
	name: string;
	meta: ModelMeta | undefined;
	decision: boolean;
	inUse: boolean;
	costPerThousandNotes: number | null;
}

export interface ModelRef {
	provider: string;
	model: string;
}

export function costPerThousandNotes(meta: ModelMeta | undefined): number | null {
	if (meta?.kind === 'local') return 0;
	if (meta?.kind !== 'priced' || meta.inputPerMTok === null || meta.outputPerMTok === null) return null;
	const perNote = ASSUMED_INPUT_TOKENS * meta.inputPerMTok + ASSUMED_OUTPUT_TOKENS * meta.outputPerMTok;
	return (perNote / 1e6) * 1000;
}

export function listInsightModels(
	providers: ReadonlyArray<ProviderConfig>,
	catalog: ModelCatalog,
	inUse: ReadonlyArray<ModelRef>
): InsightModel[] {
	const rows = new Map<string, InsightModel>();
	const add = (provider: string, model: Pick<Model, 'id' | 'name' | 'decision'>) => {
		const key = `${provider}::${model.id}`;
		if (rows.has(key)) return;
		const meta = resolveModelMeta(catalog, provider, model.id);
		rows.set(key, {
			provider,
			id: model.id,
			name: (model.name || model.id).replace(/ \(Decisions\)$/, ''),
			meta,
			decision: !!decisionTransport(provider, model),
			inUse: inUse.some((ref) => ref.provider === provider && ref.model === model.id),
			costPerThousandNotes: costPerThousandNotes(meta),
		});
	};
	for (const provider of providers) for (const model of provider.models) add(provider.name, model);
	for (const preset of Object.values(providerPresetsData)) {
		if (!COMPARED_PRESETS.has(preset.name)) continue;
		for (const model of preset.popularModels as Model[]) add(preset.name, model);
	}
	return [...rows.values()].sort(
		(a, b) => (a.costPerThousandNotes ?? Infinity) - (b.costPerThousandNotes ?? Infinity)
	);
}

export interface ChartSplit {
	plotted: Array<InsightModel & { x: number; y: number }>;
	notPlotted: InsightModel[];
}

/** The cost axis is logarithmic, so free local models can only appear in the table. */
export function splitForChart(models: ReadonlyArray<InsightModel>): ChartSplit {
	const split: ChartSplit = { plotted: [], notPlotted: [] };
	for (const model of models) {
		const x = model.costPerThousandNotes;
		const y = model.meta?.intelligenceIndex;
		if (x !== null && x > 0 && y !== null && y !== undefined) split.plotted.push({ ...model, x, y });
		else split.notPlotted.push(model);
	}
	return split;
}

export function formatUsd(value: number): string {
	if (value === 0) return '$0';
	if (value < 0.01) return `$${value.toFixed(4).replace(/0+$/, '')}`;
	if (value < 1) return `$${value.toFixed(3).replace(/0$/, '')}`;
	return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
	if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
	if (value >= 1e4) return `${Math.round(value / 1e3)}K`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
	return String(Math.round(value));
}

export function modelChips(meta: ModelMeta | undefined): string[] {
	if (!meta) return [];
	const chips: string[] = [];
	if (meta.kind === 'local') chips.push('Local');
	else if (meta.kind === 'subscription') chips.push('Included in plan');
	else if (meta.inputPerMTok !== null && meta.outputPerMTok !== null) {
		chips.push(`${formatUsd(meta.inputPerMTok)} / ${formatUsd(meta.outputPerMTok)} per MTok`);
	}
	if (meta.contextTokens !== null) chips.push(`${formatTokens(meta.contextTokens)} context`);
	return chips;
}
