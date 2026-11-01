// Dev-time only: regenerates the bundled catalog. Run with `bun scripts/update-model-catalog.ts`.
import { writeFile } from 'node:fs/promises';
import {
	MODELS_DEV_URL,
	normalizeCatalog,
	OPENROUTER_MODELS_URL,
	pricedModelCount,
} from '../src/domain/model-catalog';

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json();
}

const [modelsDev, openRouter] = await Promise.all([
	fetchJson(MODELS_DEV_URL),
	fetchJson(OPENROUTER_MODELS_URL),
]);
const catalog = normalizeCatalog({
	modelsDev,
	openRouter,
	generatedAt: new Date().toISOString().slice(0, 10),
});
if (pricedModelCount(catalog) === 0) throw new Error('Catalog has no priced models');
await writeFile(
	new URL('../src/domain/model-catalog.json', import.meta.url),
	`${JSON.stringify(catalog, null, '\t')}\n`
);
console.debug(`Wrote ${pricedModelCount(catalog)} priced models`);
