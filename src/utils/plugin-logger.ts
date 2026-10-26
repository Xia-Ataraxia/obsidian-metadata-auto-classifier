const EVENT_NAMES = [
	'initialization-failed',

	'api-error',
	'validation-error',
	'unexpected-error',
] as const;
const EVENTS = new Set(EVENT_NAMES);

export type LogEvent = (typeof EVENT_NAMES)[number];
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const METRIC_KEYS = [
	'status',
	'attempt',
	'durationMs',
	'count',
	'inputTokens',
	'outputTokens',
] as const;
export type DiagnosticMetrics = Partial<Record<(typeof METRIC_KEYS)[number], number>>;

/** Only fixed event codes and finite numeric metrics may cross the diagnostic boundary. */
export class PluginLogger {
	constructor(private readonly isDebug: () => boolean = () => false) {}

	debug(event: LogEvent, metrics?: DiagnosticMetrics): void {
		if (this.isDebug()) console.debug(this.format('debug', event, metrics));
	}

	info(event: LogEvent, metrics?: DiagnosticMetrics): void {
		console.debug(this.format('info', event, metrics));
	}

	warn(event: LogEvent, metrics?: DiagnosticMetrics): void {
		console.warn(this.format('warn', event, metrics));
	}

	error(event: LogEvent, metrics?: DiagnosticMetrics): void {
		console.error(this.format('error', event, metrics));
	}

	private format(level: LogLevel, event: LogEvent, metrics?: DiagnosticMetrics): string {
		const safeEvent = EVENTS.has(event) ? event : 'diagnostic';
		const safeMetrics: string[] = [];
		if (metrics && typeof metrics === 'object') {
			try {
				for (const key of METRIC_KEYS) {
					const value: unknown = Object.getOwnPropertyDescriptor(metrics, key)?.value;
					if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
						safeMetrics.push(`${key}=${value}`);
					}
				}
			} catch {
				// Untrusted accessors/proxies are not diagnostic data.
				safeMetrics.length = 0;
			}
		}
		return `[MAC] ${level} | ${safeEvent}${safeMetrics.length ? ` | ${safeMetrics.join(' ')}` : ''}`;
	}
}
