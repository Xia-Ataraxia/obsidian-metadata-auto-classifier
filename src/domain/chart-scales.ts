export interface Scale {
	toPixel: (value: number) => number;
	ticks: number[];
}

export function linearScale(values: number[], from: number, to: number): Scale {
	const max = Math.max(0, ...values);
	const step = niceStep((max || 1) / 4);
	const top = Math.ceil((max || 1) / step) * step;
	const ticks: number[] = [];
	for (let tick = 0; tick <= top + step / 2; tick += step) ticks.push(tick);
	return { toPixel: (value) => from + (value / top) * (to - from), ticks };
}

function niceStep(rough: number): number {
	const power = 10 ** Math.floor(Math.log10(rough));
	const scaled = rough / power;
	return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

/** Non-positive values cannot sit on a log axis; callers leave them out of the plot. */
export function logScale(values: number[], from: number, to: number): Scale {
	const positive = values.filter((value) => value > 0);
	const low = Math.floor(Math.log10(Math.min(...(positive.length ? positive : [1]))));
	const high = Math.ceil(Math.log10(Math.max(...(positive.length ? positive : [10]))));
	const start = low;
	const end = high > low ? high : low + 1;
	const ticks: number[] = [];
	for (let exponent = start; exponent <= end; exponent++) {
		const decade = 10 ** exponent;
		ticks.push(decade);
		if (exponent < end) ticks.push(3 * decade);
	}
	return {
		toPixel: (value) => from + ((Math.log10(value) - start) / (end - start)) * (to - from),
		ticks,
	};
}

export interface ChartPoint {
	id: string;
	x: number;
	y: number;
}

/** Cheapest-first running maximum: each kept point beats everything cheaper than it. */
export function efficiencyFrontier<T extends ChartPoint>(points: T[]): T[] {
	const frontier: T[] = [];
	for (const point of [...points].sort((a, b) => a.x - b.x || b.y - a.y)) {
		const best = frontier[frontier.length - 1];
		if (!best || point.y > best.y) frontier.push(point);
	}
	return frontier;
}

export interface LabelRequest {
	id: string;
	text: string;
	x: number;
	y: number;
}

export interface PlacedLabel extends LabelRequest {
	labelX: number;
	labelY: number;
	anchor: 'start' | 'end' | 'middle';
}

export interface LabelBounds {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

const CHAR_WIDTH = 6.4;
const LABEL_HEIGHT = 14;
const LABEL_GAP = 13;
const DOT_CLEARANCE = 8;

/** Tries each side of a dot and keeps the first spot clear of other dots, placed labels and the plot edge. */
export function placeLabels(requests: LabelRequest[], bounds: LabelBounds): PlacedLabel[] {
	const taken: LabelBounds[] = [];
	const placed: PlacedLabel[] = [];
	for (const request of [...requests].sort((a, b) => a.x - b.x)) {
		const width = request.text.length * CHAR_WIDTH;
		const otherDots = requests
			.filter((other) => other !== request)
			.map((other) => ({
				left: other.x - DOT_CLEARANCE,
				right: other.x + DOT_CLEARANCE,
				top: other.y - DOT_CLEARANCE,
				bottom: other.y + DOT_CLEARANCE,
			}));
		type Option = Pick<PlacedLabel, 'labelX' | 'labelY' | 'anchor'>;
		const preferred: Option = { labelX: request.x + LABEL_GAP, labelY: request.y, anchor: 'start' };
		const options: Option[] = [
			preferred,
			{ labelX: request.x - LABEL_GAP, labelY: request.y, anchor: 'end' },
			{ labelX: request.x, labelY: request.y - LABEL_GAP - 2, anchor: 'middle' },
			{ labelX: request.x, labelY: request.y + LABEL_GAP + 4, anchor: 'middle' },
		];
		const rectOf = (option: Option): LabelBounds => {
			const left =
				option.anchor === 'start'
					? option.labelX
					: option.anchor === 'end'
						? option.labelX - width
						: option.labelX - width / 2;
			return {
				left,
				right: left + width,
				top: option.labelY - LABEL_HEIGHT / 2,
				bottom: option.labelY + LABEL_HEIGHT / 2,
			};
		};
		const fits = (rect: LabelBounds) =>
			rect.left >= bounds.left &&
			rect.right <= bounds.right &&
			rect.top >= bounds.top &&
			rect.bottom <= bounds.bottom &&
			![...taken, ...otherDots].some(
				(other) =>
					rect.left < other.right &&
					rect.right > other.left &&
					rect.top < other.bottom &&
					rect.bottom > other.top
			);
		const inBounds = (rect: LabelBounds) => rect.left >= bounds.left && rect.right <= bounds.right;
		const choice =
			options.find((option) => fits(rectOf(option))) ??
			options.find((option) => inBounds(rectOf(option))) ??
			preferred;
		taken.push(rectOf(choice));
		placed.push({ ...request, ...choice });
	}
	return placed;
}
