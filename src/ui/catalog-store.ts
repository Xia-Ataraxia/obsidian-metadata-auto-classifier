import { normalizePath, requestUrl } from 'obsidian';
import type { DataAdapter } from 'obsidian';
import {
	getBundledCatalog,
	MODELS_DEV_URL,
	normalizeCatalog,
	parseCatalog,
	pricedModelCount,
} from '../domain/model-catalog';
import type { ModelCatalog } from '../types/insights';

export class CatalogStore {
	private catalog: ModelCatalog = getBundledCatalog();
	private loading: Promise<boolean> | undefined;
	private readonly path: string;

	constructor(
		private readonly adapter: DataAdapter,
		configDir: string,
		pluginId: string
	) {
		this.path = normalizePath(`${configDir}/plugins/${pluginId}/catalog-cache.json`);
	}

	get current(): ModelCatalog {
		return this.catalog;
	}

	/** Resolves true when a refreshed copy replaced the bundled snapshot. */
	load(): Promise<boolean> {
		this.loading ??= this.readCache();
		return this.loading;
	}

	private async readCache(): Promise<boolean> {
		try {
			if (!(await this.adapter.exists(this.path))) return false;
			const cached = parseCatalog(JSON.parse(await this.adapter.read(this.path)) as unknown);
			if (!cached) return false;
			this.catalog = cached;
			return true;
		} catch {
			return false;
		}
	}

	/** The only network call this feature makes, and only after an explicit click. */
	async refresh(): Promise<ModelCatalog> {
		const response = await requestUrl({ url: MODELS_DEV_URL });
		const next = normalizeCatalog({
			modelsDev: response.json as unknown,
			previous: this.catalog,
			generatedAt: new Date().toISOString().slice(0, 10),
		});
		if (pricedModelCount(next) === 0) throw new Error('The price list had no usable models');
		await this.adapter.write(this.path, JSON.stringify(next));
		this.catalog = next;
		return next;
	}
}
