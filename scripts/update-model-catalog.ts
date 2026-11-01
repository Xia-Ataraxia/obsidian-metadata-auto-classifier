// Dev-time only: regenerates the bundled catalog. Run with `bun scripts/update-model-catalog.ts`.
import { readFile, writeFile } from 'node:fs/promises';
import {
	MODELS_DEV_URL,
	normalizeCatalog,
	OPENROUTER_MODELS_URL,
	parseCatalog,
	pricedModelCount,
} from '../src/domain/model-catalog';

const CATALOG_FILE = new URL('../src/domain/model-catalog.json', import.meta.url);

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json();
}

const [modelsDev, openRouter, existing] = await Promise.all([
	fetchJson(MODELS_DEV_URL),
	fetchJson(OPENROUTER_MODELS_URL),
	readFile(CATALOG_FILE, 'utf8').then((text) => parseCatalog(JSON.parse(text) as unknown)),
]);
const normalized = normalizeCatalog({
	modelsDev,
	openRouter,
	generatedAt: new Date().toISOString().slice(0, 10),
});
// The sources reorder models between fetches, so ids are sorted to keep diffs down to real value changes.
const catalog = {
	...normalized,
	models: Object.fromEntries(
		Object.entries(normalized.models).map(([provider, models]) => [
			provider,
			Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))),
		])
	),
};
if (pricedModelCount(catalog) === 0) throw new Error('Catalog has no priced models');

// Without this, the date alone would open a pull request on every scheduled run.
if (JSON.stringify(existing?.models) === JSON.stringify(catalog.models)) {
	console.debug('Catalog unchanged');
} else {
	await writeFile(CATALOG_FILE, `${JSON.stringify(catalog, null, '\t')}\n`);
	console.debug(`Wrote ${pricedModelCount(catalog)} priced models`);
}
