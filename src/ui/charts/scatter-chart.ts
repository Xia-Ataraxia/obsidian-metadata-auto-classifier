import { setTooltip } from 'obsidian';
import {
	efficiencyFrontier,
	linearScale,
	logScale,
	placeLabels,
} from '../../domain/chart-scales';
import type { AxisDefinition, InsightModel } from '../../domain/insights-model';
import { providerClass, svgText } from './svg';

const MAX_WIDTH = 720;
const MIN_WIDTH = 340;
const HEIGHT = 340;
const MARGIN = { left: 56, right: 16, top: 14, bottom: 44 };
const CLUSTER_PX = 10;

export interface ScatterPoint {
	id: string;
	model: InsightModel;
	x: number;
	y: number;
}

export interface ScatterOptions {
	points: ScatterPoint[];
	xAxis: AxisDefinition;
	yAxis: AxisDefinition;
	showFrontier: boolean;
	onPointClick: (id: string) => void;
}

export interface ScatterHandle {
	highlight: (id: string | null) => void;
}

function shortName(name: string): string {
	return name.replace(/^Claude /, '');
}

export function renderScatter(containerEl: HTMLElement, options: ScatterOptions): ScatterHandle {
	const { points, xAxis, yAxis } = options;
	// Sized to the real width so chart text keeps its size on phones instead of scaling down.
	const WIDTH = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, containerEl.clientWidth || MAX_WIDTH));
	const left = MARGIN.left;
	const right = WIDTH - MARGIN.right;
	const top = MARGIN.top;
	const bottom = HEIGHT - MARGIN.bottom;
	const xValues = points.map((point) => point.x);
	const yValues = points.map((point) => point.y);
	const xScale = xAxis.log ? logScale(xValues, left, right) : linearScale(xValues, left, right);
	const yScale = yAxis.log ? logScale(yValues, bottom, top) : linearScale(yValues, bottom, top);

	const svg = containerEl.createSvg('svg', {
		cls: ['mac-chart', 'mac-scatter'],
		attr: { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': `${yAxis.label} by ${xAxis.label}` },
	});

	for (const tick of xScale.ticks) {
		const x = xScale.toPixel(tick);
		if (x < left - 0.5 || x > right + 0.5) continue;
		svg.createSvg('line', { cls: 'mac-chart-grid', attr: { x1: x, x2: x, y1: top, y2: bottom } });
		svgText(svg, xAxis.format(tick), { x, y: bottom + 16, cls: 'mac-chart-tick', anchor: 'middle' });
	}
	for (const tick of yScale.ticks) {
		const y = yScale.toPixel(tick);
		if (y < top - 0.5 || y > bottom + 0.5) continue;
		svg.createSvg('line', { cls: 'mac-chart-grid', attr: { x1: left, x2: right, y1: y, y2: y } });
		svgText(svg, yAxis.format(tick), { x: left - 8, y: y + 4, cls: 'mac-chart-tick', anchor: 'end' });
	}
	svgText(svg, xAxis.label, {
		x: (left + right) / 2,
		y: HEIGHT - 6,
		cls: 'mac-chart-axis-title',
		anchor: 'middle',
	});
	const yTitle = svgText(svg, yAxis.label, { x: 0, y: 0, cls: 'mac-chart-axis-title', anchor: 'middle' });
	yTitle.setAttribute('transform', `translate(14 ${(top + bottom) / 2}) rotate(-90)`);

	const placed = points.map((point) => ({
		...point,
		px: xScale.toPixel(point.x),
		py: yScale.toPixel(point.y),
	}));

	if (options.showFrontier) {
		const line = efficiencyFrontier(
			placed.map((point) => ({ id: point.id, x: point.x, y: point.y, px: point.px, py: point.py }))
		);
		if (line.length > 1) {
			svg.createSvg('polyline', {
				cls: 'mac-chart-frontier',
				attr: { points: line.map((point) => `${point.px},${point.py}`).join(' ') },
			});
		}
	}

	const dots = new Map<string, SVGElement>();
	for (const point of placed) {
		const dot = svg.createSvg('circle', {
			cls: ['mac-chart-dot', providerClass(point.model.provider)],
			attr: { cx: point.px, cy: point.py, r: point.model.selected ? 7 : 5.5 },
		});
		if (point.model.selected) dot.addClass('is-selected');
		setTooltip(dot as unknown as HTMLElement, `${point.model.name} · ${point.model.provider}`);
		dot.addEventListener('click', () => options.onPointClick(point.id));
		dots.set(point.id, dot);
	}

	const clusters: Array<{ x: number; y: number; ids: string[]; names: string[]; selected: boolean }> = [];
	for (const point of placed) {
		const cluster = clusters.find(
			(item) => Math.abs(item.x - point.px) < CLUSTER_PX && Math.abs(item.y - point.py) < CLUSTER_PX
		);
		if (cluster) {
			cluster.ids.push(point.id);
			cluster.names.push(shortName(point.model.name));
			cluster.selected ||= point.model.selected;
		} else {
			clusters.push({
				x: point.px,
				y: point.py,
				ids: [point.id],
				names: [shortName(point.model.name)],
				selected: point.model.selected,
			});
		}
	}
	const labels = placeLabels(
		clusters.map((cluster) => ({
			id: cluster.ids.join('|'),
			text: cluster.names.join(' · '),
			x: cluster.x,
			y: cluster.y,
		})),
		{ left, right, top, bottom }
	);
	for (const label of labels) {
		const cluster = clusters.find((item) => item.ids.join('|') === label.id);
		svgText(svg, label.text, {
			x: label.labelX,
			y: label.labelY + 4,
			cls: cluster?.selected ? 'mac-chart-label is-selected' : 'mac-chart-label',
			anchor: label.anchor,
		});
	}

	return {
		highlight: (id) => {
			for (const [dotId, dot] of dots) dot.toggleClass('is-highlighted', dotId === id);
		},
	};
}
