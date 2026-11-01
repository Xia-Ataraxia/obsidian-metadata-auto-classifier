import { ButtonComponent, DropdownComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import {
	AXES,
	cacheStats,
	costForNotes,
	formatLatency,
	formatTokens,
	formatUsd,
	listInsightModels,
	monthlySpend,
	tokensPerNote,
} from '../../../domain/insights-model';
import type { AxisDefinition, AxisId, InsightModel, ModelSelectionRef } from '../../../domain/insights-model';
import type { ProviderConfig } from '../../../types';
import type { TokenUsage, UsageLedger } from '../../../types/insights';
import type { CatalogStore } from '../../catalog-store';
import { renderAlternatives, renderCacheRing, renderMonthlyBars } from '../../charts/cost-charts';
import type { AlternativeBar } from '../../charts/cost-charts';
import { renderScatter } from '../../charts/scatter-chart';
import type { ScatterHandle, ScatterPoint } from '../../charts/scatter-chart';
import { providerClass } from '../../charts/svg';

type TabId = 'cost' | 'compare';
type ColumnId = 'price' | 'cache' | 'limits' | 'knowledge' | 'intelligence';

const COLUMN_LABELS: Array<[ColumnId, string]> = [
	['price', 'Price'],
	['cache', 'Cache'],
	['limits', 'Token limits'],
	['knowledge', 'Knowledge'],
	['intelligence', 'Intelligence'],
];
const MAX_ALTERNATIVES = 6;
const EMPTY_VAULT_NOTES = 1000;

export interface InsightsModalProps {
	providers: ProviderConfig[];
	selection: ModelSelectionRef | undefined;
	catalog: CatalogStore;
	ledger: UsageLedger;
	vaultNotes: number;
	onError: (message: string) => void;
	onCatalogChanged: () => void;
}

export class InsightsModal extends Modal {
	private tab: TabId = 'cost';
	private xAxis: AxisId = 'cost';
	private yAxis: AxisId = 'intelligence';
	private readonly columns = new Set<ColumnId>(['price', 'cache', 'limits']);
	private bodyEl!: HTMLElement;
	private footerEl!: HTMLElement;
	private tabButtons = new Map<TabId, HTMLElement>();

	constructor(
		app: App,
		private readonly props: InsightsModalProps
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('mac-insights-modal');
		this.setTitle('Model insights');
		const { contentEl } = this;
		contentEl.empty();
		const tabs = contentEl.createDiv({ cls: 'mac-tabs', attr: { role: 'tablist' } });
		for (const [id, label] of [
			['cost', 'My cost'],
			['compare', 'Compare models'],
		] as Array<[TabId, string]>) {
			const button = tabs.createEl('button', {
				cls: 'mac-tab',
				text: label,
				attr: { role: 'tab', type: 'button' },
			});
			button.addEventListener('click', () => this.showTab(id));
			this.tabButtons.set(id, button);
		}
		this.bodyEl = contentEl.createDiv({ cls: 'mac-insights-body' });
		this.footerEl = contentEl.createDiv({ cls: 'mac-insights-footer' });
		this.renderFooter();
		this.showTab('cost');
	}

	onClose(): void {
		this.contentEl.empty();
		this.tabButtons.clear();
	}

	private showTab(tab: TabId): void {
		this.tab = tab;
		for (const [id, button] of this.tabButtons) {
			button.toggleClass('is-active', id === tab);
			button.setAttribute('aria-selected', String(id === tab));
		}
		this.bodyEl.empty();
		const panel = this.bodyEl.createDiv({ cls: 'mac-insights-panel' });
		if (tab === 'cost') this.renderCost(panel);
		else this.renderCompare(panel);
	}

	private models(): InsightModel[] {
		const { providers, catalog, ledger, selection } = this.props;
		return listInsightModels(providers, catalog.current, ledger, selection);
	}

	private tokens(): ReturnType<typeof tokensPerNote> {
		return tokensPerNote(this.props.ledger, this.props.selection);
	}

	private renderCost(panel: HTMLElement): void {
		const { catalog, ledger, vaultNotes } = this.props;
		const notes = vaultNotes > 0 ? vaultNotes : EMPTY_VAULT_NOTES;
		const models = this.models();
		const perNote = this.tokens();
		const target =
			models.find((model) => model.selected) ??
			models.find((model) => model.decision) ??
			models[0];

		const hero = panel.createDiv({ cls: 'mac-hero' });
		const copy = hero.createDiv({ cls: 'mac-hero-copy' });
		copy.createDiv({
			cls: 'mac-insights-muted',
			text: `Classify ${vaultNotes > 0 ? 'all ' : ''}${notes.toLocaleString('en-US')} notes once with ${target?.name ?? 'your model'}`,
		});
		const cost = target ? costForNotes(target.meta, perNote.tokens, notes) : null;
		copy.createDiv({ cls: 'mac-hero-value', text: cost === null ? '—' : `≈ ${formatUsd(cost)}` });
		copy.createDiv({ cls: 'mac-insights-muted', text: this.tokenSummary(perNote, target) });
		renderCacheRing(hero, cacheStats(ledger, catalog.current));

		const grid = panel.createDiv({ cls: 'mac-cost-grid' });
		const months = grid.createDiv({ cls: 'mac-card' });
		months.createDiv({ cls: 'mac-card-title', text: 'Monthly cost' });
		renderMonthlyBars(months, monthlySpend(ledger, catalog.current, new Date()));

		const others = grid.createDiv({ cls: 'mac-card' });
		others.createDiv({ cls: 'mac-card-title', text: 'Same work on other models' });
		renderAlternatives(others, this.alternatives(models, perNote.tokens, notes));
		others.createDiv({
			cls: 'mac-card-note',
			text: 'Token cost only. Decision API models classify notes; chat models generate new tags.',
		});
	}

	private tokenSummary(perNote: ReturnType<typeof tokensPerNote>, target: InsightModel | undefined): string {
		const { tokens, source } = perNote;
		const input = tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens;
		const amounts = `${formatTokens(input)} input and ${formatTokens(tokens.outputTokens)} output tokens per run`;
		if (target?.meta?.kind === 'local') return 'Runs on your machine, so there is no API cost.';
		if (target?.meta?.kind === 'subscription') return 'Included in your plan, so there is no per-token cost.';
		if (source === 'real') return `${amounts}, from your runs.`;
		if (source === 'blended') return `${amounts}, from your runs on other models.`;
		return `Example: ${amounts}. Run a classification to see your real costs.`;
	}

	private alternatives(models: InsightModel[], tokens: TokenUsage, notes: number): AlternativeBar[] {
		const priced = models
			.map((model) => ({ model, cost: costForNotes(model.meta, tokens, notes) }))
			.filter((row): row is { model: InsightModel; cost: number } => row.cost !== null && row.cost > 0)
			.sort((a, b) => a.cost - b.cost);
		const shown = priced.slice(0, MAX_ALTERNATIVES);
		const selected = priced.find((row) => row.model.selected);
		if (selected && !shown.includes(selected)) shown[shown.length - 1] = selected;
		return shown.map(({ model, cost }) => ({
			id: `${model.provider}::${model.id}`,
			name: model.name,
			provider: model.provider,
			cost,
			selected: model.selected,
		}));
	}

	private renderCompare(panel: HTMLElement): void {
		const axes = panel.createDiv({ cls: 'mac-axes' });
		const axisPicker = (label: string, value: AxisId, onChange: (next: AxisId) => void) => {
			const field = axes.createEl('label', { cls: 'mac-axis-field' });
			field.createSpan({ cls: 'mac-insights-muted', text: label });
			const dropdown = new DropdownComponent(field);
			for (const axis of AXES) dropdown.addOption(axis.id, axis.label);
			dropdown.setValue(value).onChange((next) => onChange(next as AxisId));
		};
		axisPicker('X axis', this.xAxis, (next) => {
			this.xAxis = next;
			this.showTab('compare');
		});
		axisPicker('Y axis', this.yAxis, (next) => {
			this.yAxis = next;
			this.showTab('compare');
		});

		const models = this.models();
		const tokens = this.tokens().tokens;
		const xAxis = AXES.find((axis) => axis.id === this.xAxis) as AxisDefinition;
		const yAxis = AXES.find((axis) => axis.id === this.yAxis) as AxisDefinition;
		const points: ScatterPoint[] = [];
		const missing: string[] = [];
		for (const model of models) {
			const x = xAxis.value(model, tokens);
			const y = yAxis.value(model, tokens);
			const plottable =
				x !== null && y !== null && (!xAxis.log || x > 0) && (!yAxis.log || y > 0);
			if (plottable) points.push({ id: `${model.provider}::${model.id}`, model, x, y });
			else missing.push(model.name);
		}

		const legend = axes.createDiv({ cls: 'mac-legend mac-axes-legend' });
		for (const provider of new Set(points.map((point) => point.model.provider))) {
			const item = legend.createSpan({ cls: 'mac-legend-item' });
			const swatch = item.createSvg('svg', { cls: 'mac-legend-swatch', attr: { viewBox: '0 0 10 10' } });
			swatch.createSvg('circle', {
				cls: ['mac-chart-dot-static', providerClass(provider)],
				attr: { cx: 5, cy: 5, r: 5 },
			});
			item.createSpan({ text: provider });
		}

		const rows = new Map<string, HTMLElement>();
		let scatter: ScatterHandle | undefined;
		if (points.length === 0) {
			const empty = panel.createDiv({ cls: 'mac-chart-empty' });
			empty.createDiv({ text: 'Nothing to plot on these axes yet' });
			empty.createDiv({
				cls: 'mac-insights-muted',
				text: 'Latency appears after you run a classification or test a model.',
			});
		} else {
			scatter = renderScatter(panel, {
				points,
				xAxis,
				yAxis,
				showFrontier: this.yAxis === 'intelligence' && (this.xAxis === 'cost' || this.xAxis === 'input'),
				onPointClick: (id) => {
					const row = rows.get(id);
					if (!row) return;
					for (const other of rows.values()) other.removeClass('is-highlighted');
					row.addClass('is-highlighted');
					row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				},
			});
		}
		if (missing.length > 0) {
			panel.createDiv({ cls: 'mac-card-note', text: `Not plotted: ${missing.join(', ')}` });
		}

		const chips = panel.createDiv({ cls: 'mac-chips' });
		const tableWrap = panel.createDiv({ cls: 'mac-table-wrap' });
		const renderTable = () => {
			tableWrap.empty();
			rows.clear();
			this.renderTable(tableWrap, models, tokens, rows, (id) => scatter?.highlight(id));
		};
		for (const [column, label] of COLUMN_LABELS) {
			const chip = chips.createEl('button', {
				cls: 'mac-chip',
				text: label,
				attr: { type: 'button', 'aria-pressed': String(this.columns.has(column)) },
			});
			chip.toggleClass('is-active', this.columns.has(column));
			chip.addEventListener('click', () => {
				if (this.columns.has(column)) this.columns.delete(column);
				else this.columns.add(column);
				chip.toggleClass('is-active', this.columns.has(column));
				chip.setAttribute('aria-pressed', String(this.columns.has(column)));
				renderTable();
			});
		}
		renderTable();
	}

	private renderTable(
		containerEl: HTMLElement,
		models: InsightModel[],
		tokens: TokenUsage,
		rows: Map<string, HTMLElement>,
		onHover: (id: string | null) => void
	): void {
		const table = containerEl.createEl('table', { cls: 'mac-table' });
		const head = table.createEl('thead').createEl('tr');
		head.createEl('th', { text: 'Model' });
		const headers: Array<[ColumnId, string, string]> = [
			['price', 'Input / output per MTok', 'mac-col-price'],
			['cache', 'Cache read', 'mac-col-cache'],
			['limits', 'Context / output', 'mac-col-limits'],
			['knowledge', 'Knowledge', 'mac-col-knowledge'],
			['intelligence', 'Intelligence', 'mac-col-intelligence'],
		];
		for (const [column, label, cls] of headers) {
			if (this.columns.has(column)) head.createEl('th', { cls: ['mac-num', cls], text: label });
		}
		head.createEl('th', { cls: 'mac-num', text: 'Per 1,000 notes' });

		const body = table.createEl('tbody');
		const sorted = models
			.map((model) => ({ model, cost: costForNotes(model.meta, tokens, 1000) }))
			.sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
		for (const { model, cost } of sorted) {
			const id = `${model.provider}::${model.id}`;
			const row = body.createEl('tr', { cls: model.selected ? ['is-selected'] : [] });
			rows.set(id, row);
			row.addEventListener('mouseenter', () => onHover(id));
			row.addEventListener('mouseleave', () => onHover(null));
			this.renderRow(row, model, cost);
		}
	}

	private renderRow(row: HTMLElement, model: InsightModel, cost: number | null): void {
		const meta = model.meta;
		const nameCell = row.createEl('td');
		const title = nameCell.createDiv({ cls: 'mac-model-title' });
		const swatch = title.createSvg('svg', { cls: 'mac-legend-swatch', attr: { viewBox: '0 0 10 10' } });
		swatch.createSvg('circle', {
			cls: ['mac-chart-dot-static', providerClass(model.provider)],
			attr: { cx: 5, cy: 5, r: 5 },
		});
		title.createSpan({ cls: 'mac-model-name', text: model.name });
		title.createSpan({
			cls: model.decision ? ['mac-pill', 'is-decision'] : ['mac-pill'],
			text: model.decision ? 'Decision' : 'Chat',
		});
		const latency = model.latencyMs === null ? '' : ` · ${formatLatency(model.latencyMs)}`;
		nameCell.createDiv({ cls: 'mac-insights-muted', text: `${model.provider}${latency}` });

		const usd = (value: number | null | undefined) =>
			value === null || value === undefined ? '—' : formatUsd(value);
		if (this.columns.has('price')) {
			const text =
				meta?.kind === 'local'
					? 'Local'
					: meta?.kind === 'subscription'
						? 'Included in plan'
						: `${usd(meta?.inputPerMTok)} / ${usd(meta?.outputPerMTok)}`;
			row.createEl('td', { cls: ['mac-num', 'mac-col-price'], text });
		}
		if (this.columns.has('cache')) {
			row.createEl('td', { cls: ['mac-num', 'mac-col-cache'], text: usd(meta?.cacheReadPerMTok) });
		}
		if (this.columns.has('limits')) {
			const tokenText = (value: number | null | undefined) =>
				value === null || value === undefined ? '—' : formatTokens(value);
			row.createEl('td', {
				cls: ['mac-num', 'mac-col-limits'],
				text: `${tokenText(meta?.contextTokens)} / ${tokenText(meta?.maxOutputTokens)}`,
			});
		}
		if (this.columns.has('knowledge')) {
			row.createEl('td', { cls: ['mac-num', 'mac-col-knowledge'], text: meta?.knowledge ?? '—' });
		}
		if (this.columns.has('intelligence')) {
			const index = meta?.intelligenceIndex;
			row.createEl('td', {
				cls: ['mac-num', 'mac-col-intelligence'],
				text: index === null || index === undefined ? '—' : String(Math.round(index)),
			});
		}
		row.createEl('td', { cls: ['mac-num', 'mac-strong'], text: cost === null ? '—' : formatUsd(cost) });
	}

	private renderFooter(): void {
		const { catalog } = this.props;
		this.footerEl.empty();
		const current = catalog.current;
		const hasIndex = current.sources.includes('openrouter.ai');
		this.footerEl.createDiv({
			cls: 'mac-insights-muted',
			text: `Prices as of ${current.generatedAt} from models.dev. Estimates only${
				hasIndex ? '. Intelligence index by Artificial Analysis, via OpenRouter' : ''
			}.`,
		});
		const button = new ButtonComponent(this.footerEl).setButtonText('Refresh prices');
		button.onClick(async () => {
			button.setDisabled(true).setButtonText('Refreshing…');
			try {
				await catalog.refresh();
				this.renderFooter();
				this.showTab(this.tab);
				this.props.onCatalogChanged();
			} catch {
				this.props.onError('Could not refresh prices. The saved prices are still in use.');
				button.setDisabled(false).setButtonText('Refresh prices');
			}
		});
	}
}
