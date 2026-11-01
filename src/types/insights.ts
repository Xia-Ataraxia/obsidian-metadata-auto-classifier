/** priced: per-token API billing. local: runs on the user's machine. subscription: billed by a plan. unpriced: no public price. */
export type ModelKind = 'priced' | 'local' | 'subscription' | 'unpriced';

export interface ModelMeta {
	kind: ModelKind;
	inputPerMTok: number | null;
	outputPerMTok: number | null;
	cacheReadPerMTok: number | null;
	cacheWritePerMTok: number | null;
	contextTokens: number | null;
	maxOutputTokens: number | null;
	knowledge: string | null;
	intelligenceIndex: number | null;
}

export interface ModelCatalog {
	schemaVersion: 1;
	generatedAt: string;
	sources: string[];
	/** Provider display name -> model id -> metadata. */
	models: Record<string, Record<string, ModelMeta>>;
}
