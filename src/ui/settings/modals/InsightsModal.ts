import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import {
	ASSUMED_INPUT_TOKENS,
	ASSUMED_OUTPUT_TOKENS,
	formatTokens,
	formatUsd,
	listInsightModels,
	splitForChart,
} from '../../../domain/insights-model';
import type { InsightModel, ModelRef } from '../../../domain/insights-model';
import type { ProviderConfig } from '../../../types';
import type { ModelMeta } from '../../../types/insights';
import type { CatalogStore } from '../../catalog-store';
import { renderScatter } from '../../charts/scatter-chart';
import { providerClass } from '../../charts/svg';

// models.dev lists DeepSeek's off-peak rate; its official pricing doubles at peak hours.
const OFF_PEAK_PROVIDER = 'DeepSeek';

export interface InsightsModalProps {
	providers: ProviderConfig[];
	inUse: ModelRef[];
	catalog: CatalogStore;
	onError: (message: string) => void;
	onCatalogChanged: () => void;
}

function usd(value: number | null | undefined): string {
	return value === null || value === undefined ? '—' : formatUsd(value);
}

function tokens(value: number | null | undefined): string {
	return value === null || value === undefined ? '—' : formatTokens(value);
}

function priceText(meta: ModelMeta | undefined): string {
	if (meta?.kind === 'local') return 'Local';
	if (meta?.kind === 'subscription') return 'Included in plan';
	if (meta?.inputPerMTok === null || meta?.inputPerMTok === undefined) return 'Not published';
	return `${usd(meta.inputPerMTok)} / ${usd(meta.outputPerMTok)}`;
}

export class InsightsModal extends Modal {
	private bodyEl!: HTMLElement;
	private footerEl!: HTMLElement;

	constructor(
		app: App,
		private readonly props: InsightsModalProps
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('mac-insights-modal');
		this.setTitle('Model insights');
		this.contentEl.empty();
		this.bodyEl = this.contentEl.createDiv({ cls: 'mac-insights-body' });
		this.footerEl = this.contentEl.createDiv({ cls: 'mac-insights-footer' });
		this.render();
	}

	open(): void {
		super.open();
		// Modal.open focuses the first button, and a stray Enter or Space there would fetch prices.
		this.bodyEl.setAttr('tabindex', '-1');
		this.bodyEl.focus({ preventScroll: true });
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { providers, catalog, inUse } = this.props;
		this.bodyEl.empty();
		this.renderFooter();
		const panel = this.bodyEl.createDiv({ cls: 'mac-insights-panel' });
		const models = listInsightModels(providers, catalog.current, inUse);
		const decision = models.filter((model) => model.decision);
		const chat = models.filter((model) => !model.decision);

		this.renderSectionHeading(panel, 'Classification', 'Decision API models score your existing values.');
		this.renderTable(panel, decision, new Map());

		this.renderSectionHeading(panel, 'Tag generation', 'Chat models write new tags when a field allows it.');
		const rows = new Map<string, HTMLElement>();
		const { plotted, notPlotted } = splitForChart(chat);
		const scatter =
			plotted.length > 0
				? renderScatter(panel, {
						points: plotted,
						onPointClick: (id) => {
							const row = rows.get(id);
							if (!row) return;
							for (const other of rows.values()) other.removeClass('is-highlighted');
							row.addClass('is-highlighted');
							row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
						},
					})
				: undefined;
		if (notPlotted.length > 0) {
			panel.createDiv({
				cls: 'mac-insights-note',
				text: `No chart data: ${notPlotted.map((model) => model.name).join(', ')}`,
			});
		}
		this.renderTable(panel, chat, rows, (id) => scatter?.highlight(id));
	}

	private renderSectionHeading(containerEl: HTMLElement, title: string, description: string): void {
		const heading = containerEl.createDiv({ cls: 'mac-section-heading' });
		heading.createDiv({ cls: 'mac-section-title', text: title });
		heading.createDiv({ cls: 'mac-insights-note', text: description });
	}

	private renderTable(
		containerEl: HTMLElement,
		models: InsightModel[],
		rows: Map<string, HTMLElement>,
		onHover?: (id: string | null) => void
	): void {
		const wrap = containerEl.createDiv({ cls: 'mac-table-wrap' });
		const table = wrap.createEl('table', { cls: 'mac-table' });
		const head = table.createEl('thead').createEl('tr');
		head.createEl('th', { text: 'Model' });
		head.createEl('th', { cls: 'mac-num', text: 'Input / output per million' });
		head.createEl('th', { cls: ['mac-num', 'mac-col-cache'], text: 'Cache read' });
		head.createEl('th', { cls: ['mac-num', 'mac-col-limits'], text: 'Context / output' });
		head.createEl('th', { cls: ['mac-num', 'mac-col-index'], text: 'Intelligence' });
		head.createEl('th', { cls: 'mac-num', text: 'Per 1,000 notes' });

		const body = table.createEl('tbody');
		for (const model of models) {
			const id = `${model.provider}::${model.id}`;
			const row = body.createEl('tr', { cls: model.inUse ? ['is-selected'] : [] });
			rows.set(id, row);
			if (onHover) {
				row.addEventListener('mouseenter', () => onHover(id));
				row.addEventListener('mouseleave', () => onHover(null));
			}
			this.renderRow(row, model);
		}
	}

	private renderRow(row: HTMLElement, model: InsightModel): void {
		const meta = model.meta;
		const nameCell = row.createEl('td');
		const title = nameCell.createDiv({ cls: 'mac-model-title' });
		const swatch = title.createSvg('svg', { cls: 'mac-legend-swatch', attr: { viewBox: '0 0 10 10' } });
		swatch.createSvg('circle', {
			cls: ['mac-chart-dot-static', providerClass(model.provider)],
			attr: { cx: 5, cy: 5, r: 5 },
		});
		title.createSpan({ cls: 'mac-model-name', text: model.name });
		if (model.inUse) title.createSpan({ cls: 'mac-pill', text: 'In use' });
		nameCell.createDiv({ cls: 'mac-insights-note', text: model.provider });

		row.createEl('td', { cls: 'mac-num', text: priceText(meta) });
		row.createEl('td', { cls: ['mac-num', 'mac-col-cache'], text: usd(meta?.cacheReadPerMTok) });
		row.createEl('td', {
			cls: ['mac-num', 'mac-col-limits'],
			text: `${tokens(meta?.contextTokens)} / ${tokens(meta?.maxOutputTokens)}`,
		});
		const index = meta?.intelligenceIndex;
		row.createEl('td', {
			cls: ['mac-num', 'mac-col-index'],
			text: index === null || index === undefined ? '—' : String(Math.round(index)),
		});
		row.createEl('td', { cls: ['mac-num', 'mac-strong'], text: usd(model.costPerThousandNotes) });
	}

	private renderFooter(): void {
		const { catalog, providers, inUse } = this.props;
		this.footerEl.empty();
		const current = catalog.current;
		const copy = this.footerEl.createDiv({ cls: 'mac-insights-note' });
		const hasOffPeak = listInsightModels(providers, current, inUse).some(
			(model) => model.provider === OFF_PEAK_PROVIDER
		);
		copy.setText(
			[
				`Prices as of ${current.generatedAt} from models.dev.`,
				`Per 1,000 notes assumes ${formatTokens(ASSUMED_INPUT_TOKENS)} input and ${ASSUMED_OUTPUT_TOKENS} output tokens a note, without caching.`,
				current.sources.includes('openrouter.ai') ? 'Intelligence index by Artificial Analysis, via OpenRouter.' : '',
				hasOffPeak ? `${OFF_PEAK_PROVIDER} prices are off-peak; peak hours cost double.` : '',
			]
				.filter(Boolean)
				.join(' ')
		);
		const button = new ButtonComponent(this.footerEl).setButtonText('Refresh prices');
		button.onClick(async () => {
			button.setDisabled(true).setButtonText('Refreshing…');
			try {
				await catalog.refresh();
				this.render();
				this.props.onCatalogChanged();
			} catch {
				this.props.onError('Could not refresh prices. The saved prices are still in use.');
				button.setDisabled(false).setButtonText('Refresh prices');
			}
		});
	}
}
