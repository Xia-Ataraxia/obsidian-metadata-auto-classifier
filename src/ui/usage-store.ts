import { debounce, normalizePath } from 'obsidian';
import type { DataAdapter } from 'obsidian';
import {
	addLatency,
	addNote,
	addUsage,
	emptyLedger,
	monthKey,
	parseLedger,
} from '../domain/usage-ledger';
import type { TokenUsage, UsageLedger, UsageSink } from '../types/insights';

const SAVE_DELAY_MS = 2_000;

/** Kept outside saveData because every settings click rewrites data.json, which would churn Sync. */
export class UsageStore implements UsageSink {
	private ledger: UsageLedger = emptyLedger();
	private loading: Promise<UsageLedger> | undefined;
	private dirty = false;
	private readonly saveLater = debounce(() => void this.flush(), SAVE_DELAY_MS, true);

	constructor(
		private readonly adapter: DataAdapter,
		configDir: string,
		pluginId: string,
		private readonly onError: () => void
	) {
		this.path = normalizePath(`${configDir}/plugins/${pluginId}/usage.json`);
	}

	private readonly path: string;

	load(): Promise<UsageLedger> {
		this.loading ??= this.read();
		return this.loading;
	}

	private async read(): Promise<UsageLedger> {
		try {
			if (await this.adapter.exists(this.path)) {
				this.ledger = parseLedger(JSON.parse(await this.adapter.read(this.path)) as unknown);
			}
		} catch {
			this.onError();
		}
		return this.ledger;
	}

	private apply(change: (ledger: UsageLedger, month: string) => void): void {
		void this.load().then((ledger) => {
			change(ledger, monthKey(new Date()));
			this.dirty = true;
			this.saveLater();
		});
	}

	record(provider: string, model: string, usage: TokenUsage, latencyMs: number): void {
		this.apply((ledger, month) => addUsage(ledger, month, provider, model, usage, latencyMs));
	}

	recordLatency(provider: string, model: string, latencyMs: number): void {
		this.apply((ledger, month) => addLatency(ledger, month, provider, model, latencyMs));
	}

	noteClassified(provider: string, model: string): void {
		this.apply((ledger, month) => addNote(ledger, month, provider, model));
	}

	async flush(): Promise<void> {
		this.saveLater.cancel();
		if (!this.dirty) return;
		this.dirty = false;
		try {
			await this.adapter.write(this.path, JSON.stringify(this.ledger));
		} catch {
			this.dirty = true;
			this.onError();
		}
	}
}
