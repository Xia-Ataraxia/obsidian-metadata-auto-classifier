import { setTooltip } from 'obsidian';
import {
	efficiencyFrontier,
	linearScale,
	logScale,
	placeLabels,
} from '../../domain/chart-scales';
import { formatUsd } from '../../domain/insights-model';
import type { ChartSplit } from '../../domain/insights-model';
import { providerClass, svgText } from './svg';

const MAX_WIDTH = 720;
const MIN_WIDTH = 340;
const HEIGHT = 320;
const MARGIN = { left: 56, right: 16, top: 14, bottom: 44 };
const CLUSTER_PX = 10;

export interface ScatterOptions {
	points: ChartSplit['plotted'];
	onPointClick: (id: string) => void;
}

export interface ScatterHandle {
	highlight: (id: string | null) => void;
}

function pointId(point: ChartSplit['plotted'][number]): string {
	return `${point.provider}::${point.id}`;
}

export function renderScatter(containerEl: HTMLElement, options: ScatterOptions): ScatterHandle {
	const { points } = options;
	// Sized to the real width so chart text keeps its size on phones instead of scaling down.
	const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, containerEl.clientWidth || MAX_WIDTH));
	const left = MARGIN.left;
	const right = width - MARGIN.right;
	const top = MARGIN.top;
	const bottom = HEIGHT - MARGIN.bottom;
	const xScale = logScale(points.map((point) => point.x), left, right);
	const yScale = linearScale(points.map((point) => point.y), bottom, top);

	const svg = containerEl.createSvg('svg', {
		cls: ['mac-chart', 'mac-scatter'],
		attr: {
			viewBox: `0 0 ${width} ${HEIGHT}`,
			role: 'img',
			'aria-label': 'Intelligence index by cost per 1,000 notes',
		},
	});

	for (const tick of xScale.ticks) {
		const x = xScale.toPixel(tick);
		if (x < left - 0.5 || x > right + 0.5) continue;
		svg.createSvg('line', { cls: 'mac-chart-grid', attr: { x1: x, x2: x, y1: top, y2: bottom } });
		svgText(svg, formatUsd(tick), { x, y: bottom + 16, cls: 'mac-chart-tick', anchor: 'middle' });
	}
	for (const tick of yScale.ticks) {
		const y = yScale.toPixel(tick);
		svg.createSvg('line', { cls: 'mac-chart-grid', attr: { x1: left, x2: right, y1: y, y2: y } });
		svgText(svg, String(Math.round(tick)), {
			x: left - 8,
			y: y + 4,
			cls: 'mac-chart-tick',
			anchor: 'end',
		});
	}
	svgText(svg, 'Cost per 1,000 notes', {
		x: (left + right) / 2,
		y: HEIGHT - 6,
		cls: 'mac-chart-axis-title',
		anchor: 'middle',
	});
	const yTitle = svgText(svg, 'Intelligence index', {
		x: 0,
		y: 0,
		cls: 'mac-chart-axis-title',
		anchor: 'middle',
	});
	yTitle.setAttribute('transform', `translate(14 ${(top + bottom) / 2}) rotate(-90)`);

	const placed = points.map((point) => ({
		point,
		id: pointId(point),
		x: point.x,
		y: point.y,
		px: xScale.toPixel(point.x),
		py: yScale.toPixel(point.y),
	}));

	const frontier = efficiencyFrontier(placed);
	if (frontier.length > 1) {
		svg.createSvg('polyline', {
			cls: 'mac-chart-frontier',
			attr: { points: frontier.map((item) => `${item.px},${item.py}`).join(' ') },
		});
	}

	const dots = new Map<string, SVGElement>();
	for (const { point, id, px, py } of placed) {
		const dot = svg.createSvg('circle', {
			cls: ['mac-chart-dot', providerClass(point.provider)],
			attr: { cx: px, cy: py, r: point.inUse ? 7 : 5.5 },
		});
		if (point.inUse) dot.addClass('is-selected');
		setTooltip(dot as unknown as HTMLElement, `${point.name} · ${point.provider}`);
		dot.addEventListener('click', () => options.onPointClick(id));
		dots.set(id, dot);
	}

	const clusters: Array<{ x: number; y: number; ids: string[]; names: string[]; inUse: boolean }> = [];
	for (const { point, id, px, py } of placed) {
		const name = point.name.replace(/^Claude /, '');
		const cluster = clusters.find(
			(item) => Math.abs(item.x - px) < CLUSTER_PX && Math.abs(item.y - py) < CLUSTER_PX
		);
		if (cluster) {
			cluster.ids.push(id);
			cluster.names.push(name);
			cluster.inUse ||= point.inUse;
		} else {
			clusters.push({ x: px, y: py, ids: [id], names: [name], inUse: point.inUse });
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
			cls: cluster?.inUse ? 'mac-chart-label is-selected' : 'mac-chart-label',
			anchor: label.anchor,
		});
	}

	return {
		highlight: (id) => {
			for (const [dotId, dot] of dots) dot.toggleClass('is-highlighted', dotId === id);
		},
	};
}
