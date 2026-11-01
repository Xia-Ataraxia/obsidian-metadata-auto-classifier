import { formatUsd } from '../../domain/insights-model';
import type { CacheStats, MonthSpend } from '../../domain/insights-model';
import { providerClass, svgText } from './svg';

const RING_RADIUS = 15.9155;

export function renderCacheRing(containerEl: HTMLElement, stats: CacheStats): void {
	const wrap = containerEl.createDiv({ cls: 'mac-cache' });
	const svg = wrap.createSvg('svg', {
		cls: 'mac-cache-ring',
		attr: { viewBox: '0 0 36 36', role: 'img', 'aria-label': 'Cache hit rate' },
	});
	svg.createSvg('circle', {
		cls: 'mac-cache-track',
		attr: { cx: 18, cy: 18, r: RING_RADIUS },
	});
	if (stats.hasData && stats.hitRate > 0) {
		svg.createSvg('circle', {
			cls: 'mac-cache-fill',
			attr: {
				cx: 18,
				cy: 18,
				r: RING_RADIUS,
				'stroke-dasharray': `${(stats.hitRate * 100).toFixed(1)} 100`,
			},
		});
	}
	svgText(svg, stats.hasData ? `${Math.round(stats.hitRate * 100)}%` : '—', {
		x: 18,
		y: 20.5,
		cls: 'mac-cache-value',
		anchor: 'middle',
	});
	const copy = wrap.createDiv({ cls: 'mac-cache-copy' });
	copy.createDiv({ cls: 'mac-cache-title', text: 'Cache hit rate' });
	copy.createDiv({
		cls: 'mac-insights-muted',
		text: stats.hasData
			? stats.savedUsd > 0
				? `Saved ${formatUsd(stats.savedUsd)} (${Math.round(stats.savedShare * 100)}%)`
				: 'No savings yet'
			: 'Shows after your first run',
	});
}

export function renderMonthlyBars(containerEl: HTMLElement, months: MonthSpend[]): void {
	const width = 360;
	const height = 200;
	const baseline = height - 34;
	const top = 18;
	const max = Math.max(...months.map((month) => month.projectedUsd ?? month.totalUsd), 0);
	if (max === 0) {
		const empty = containerEl.createDiv({ cls: 'mac-chart-empty' });
		empty.createDiv({ text: 'No usage yet' });
		empty.createDiv({
			cls: 'mac-insights-muted',
			text: 'Run a classification to see your real costs.',
		});
		return;
	}
	const svg = containerEl.createSvg('svg', {
		cls: ['mac-chart', 'mac-bars'],
		attr: { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Monthly cost' },
	});
	const slot = width / months.length;
	const barWidth = Math.min(34, slot - 14);
	const scale = (baseline - top) / max;
	svg.createSvg('line', {
		cls: 'mac-chart-grid',
		attr: { x1: 0, x2: width, y1: baseline, y2: baseline },
	});
	months.forEach((month, index) => {
		const x = index * slot + (slot - barWidth) / 2;
		const center = index * slot + slot / 2;
		let y = baseline;
		const segments: Array<[number, string]> = [
			[month.inputUsd, 'mac-bar-input'],
			[month.cachedUsd, 'mac-bar-cached'],
			[month.outputUsd, 'mac-bar-output'],
		];
		for (const [value, cls] of segments) {
			if (value <= 0) continue;
			const barHeight = Math.max(1, value * scale);
			y -= barHeight;
			svg.createSvg('rect', {
				cls: ['mac-bar', cls],
				attr: { x, y, width: barWidth, height: barHeight, rx: 2 },
			});
		}
		if (month.projectedUsd !== null) {
			const projectedTop = baseline - month.projectedUsd * scale;
			svg.createSvg('rect', {
				cls: 'mac-bar-projection',
				attr: { x, y: projectedTop, width: barWidth, height: baseline - projectedTop, rx: 2 },
			});
			y = projectedTop;
		}
		const shown = month.projectedUsd ?? month.totalUsd;
		if (shown > 0) {
			svgText(svg, formatUsd(shown), { x: center, y: y - 5, cls: 'mac-chart-tick', anchor: 'middle' });
		}
		svgText(svg, month.label, {
			x: center,
			y: baseline + 14,
			cls: 'mac-chart-label',
			anchor: 'middle',
		});
		svgText(svg, month.notes > 0 ? `${month.notes} runs` : '—', {
			x: center,
			y: baseline + 27,
			cls: 'mac-chart-tick',
			anchor: 'middle',
		});
	});
	const legend = containerEl.createDiv({ cls: 'mac-legend' });
	for (const [label, cls] of [
		['Input', 'mac-bar-input'],
		['Cached', 'mac-bar-cached'],
		['Output', 'mac-bar-output'],
	] as const) {
		const item = legend.createSpan({ cls: 'mac-legend-item' });
		const swatch = item.createSvg('svg', { cls: 'mac-legend-swatch', attr: { viewBox: '0 0 10 10' } });
		swatch.createSvg('rect', { cls: cls, attr: { width: 10, height: 10, rx: 2 } });
		item.createSpan({ text: label });
	}
	if (months.some((month) => month.projectedUsd !== null)) {
		legend.createSpan({ cls: 'mac-insights-muted', text: 'Dashed: this month, projected' });
	}
}

export interface AlternativeBar {
	id: string;
	name: string;
	provider: string;
	cost: number;
	selected: boolean;
}

export function renderAlternatives(containerEl: HTMLElement, rows: AlternativeBar[]): void {
	const width = 360;
	const rowHeight = 28;
	const labelWidth = 136;
	const valueWidth = 58;
	const trackWidth = width - labelWidth - valueWidth;
	const svg = containerEl.createSvg('svg', {
		cls: ['mac-chart', 'mac-alternatives'],
		attr: {
			viewBox: `0 0 ${width} ${rows.length * rowHeight}`,
			role: 'img',
			'aria-label': 'Same work on other models',
		},
	});
	const max = Math.max(...rows.map((row) => row.cost), 0);
	rows.forEach((row, index) => {
		const y = index * rowHeight + rowHeight / 2;
		svgText(svg, row.name.length > 21 ? `${row.name.slice(0, 20)}…` : row.name, {
			x: 0,
			y: y + 4,
			cls: row.selected ? 'mac-chart-label is-selected' : 'mac-chart-label',
		});
		svg.createSvg('rect', {
			cls: 'mac-alt-track',
			attr: { x: labelWidth, y: y - 4, width: trackWidth, height: 8, rx: 4 },
		});
		const barWidth = max > 0 ? Math.max(4, (row.cost / max) * trackWidth) : 4;
		svg.createSvg('rect', {
			cls: ['mac-alt-bar', providerClass(row.provider)],
			attr: { x: labelWidth, y: y - 4, width: barWidth, height: 8, rx: 4 },
		});
		svgText(svg, formatUsd(row.cost), {
			x: width,
			y: y + 4,
			cls: row.selected ? 'mac-chart-label is-selected' : 'mac-chart-label',
			anchor: 'end',
		});
	});
}
