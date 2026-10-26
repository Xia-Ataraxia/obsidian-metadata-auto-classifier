// ==========================================
// Consolidated Types - Centralized type definitions
// ==========================================

import type { OAuthTokens } from './auth';

// ==========================================
// Obsidian type shims — used to avoid importing from obsidian in domain/utils layers
// Keep in sync with the Obsidian API signatures that we depend on.
// ==========================================

/**
 * Minimal shim for Obsidian's TFile used in pure-type positions.
 * Do NOT add methods — only structural properties needed by domain code.
 */
export interface TFileShim {
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent: { path: string } | null;
}

// ==========================================
// Frontmatter Types
// ==========================================

export type LinkType = 'WikiLink' | 'Normal';

export interface Range {
	min: number;
	max: number;
}

export interface FrontmatterField {
	id: number;
	name: string;
	count: Range;
	refs: string[];
	overwrite: boolean;
	linkType: LinkType;
	customQuery: string;
	generateNewTags?: boolean;
}

export interface FrontMatter {
	[key: string]: string[];
}

// ==========================================
// Provider Types
// ==========================================

export interface Model {
	id: string;
	name: string;
}

export type AuthType = 'apiKey' | 'oauth';

/**
 * Unified authentication type - supports both API Key and OAuth
 */
export type ProviderAuth =
	| { type: 'apiKey'; apiKey: string }
	| { type: 'oauth'; oauth: OAuthTokens };

export interface ProviderBase {
	name: string;
	baseUrl: string;
	temperature?: number;
	models: Model[];
	// Explicit auth takes precedence; flat fields must not supply fallback credentials.
	auth?: ProviderAuth;
	apiKey?: string;
	authType?: AuthType;
	oauth?: OAuthTokens;
}

export type ProviderConfig = ProviderBase;

export interface GeneratedTags {
	tags: string[];
}

export interface ProviderPreset extends Omit<ProviderBase, 'apiKey'> {
	presetId?: string;
	apiKeyUrl: string;
	apiKeyRequired: boolean;
	modelsList: string;
	popularModels: Model[];
}

/**
 * Callback for when OAuth tokens are refreshed during API calls
 */
export type OnTokenRefreshCallback = (tokens: OAuthTokens) => Promise<void>;

export interface APIProvider {
	callAPI(
		systemRole: string,
		user_prompt: string,
		provider: ProviderConfig,
		selectedModel: string,
		temperature?: number,
		onTokenRefresh?: OnTokenRefreshCallback,
		requestOptions?: { deadline: number; assertCurrent?: () => void }
	): Promise<GeneratedTags>;

	buildHeaders(apiKey: string): Record<string, string>;
	processApiResponse(responseData: unknown): GeneratedTags;
}

// ==========================================
// Plugin notice types
// ==========================================

export interface NoticeDefinition {
	template: string;
	timeout?: number;
	immutable?: boolean;
	/** Adds an action button to the notice. */
	action?: 'open-settings';
}

export type NoticeCatalog = Record<string, NoticeDefinition>;

export interface NoticeShowOptions {
	timeout?: number;
	button?: { text: string; callback: () => void };
	/** Adds an inline Undo action ahead of the other button. */
	undo?: () => void;
}

export interface PluginNoticesHost {
	settings: Record<string, unknown>;
	saveSettings(): Promise<void>;
	openSettings?: () => void;
}

// ==========================================
// Settings UI Types
// ==========================================

export interface SettingsComponentOptions {
	showLinkType?: boolean;
	showOptions?: boolean;
	showTextArea?: boolean;
}

export interface SettingsComponent {
	display(frontmatterId?: number): void;
}

export interface FrontmatterActions {
	onEdit: (frontmatterSetting: FrontmatterField) => void;
	onDelete: (frontmatterSetting: FrontmatterField) => void;
}

export interface FrontmatterEditorModalProps {
	frontmatterSetting: FrontmatterField;
	options: SettingsComponentOptions;
	onSave: (frontmatter: FrontmatterField) => Promise<void>;
}

/**
 * Frontmatter reference type - minimal identification info for selection/reference
 */
export type FrontmatterRef = Pick<FrontmatterField, 'id' | 'name'>;

// ==========================================
// Plugin Settings Type
// ==========================================

export interface AutoClassifierSettings {
	jev: { apiKey: string; model: string };
	providers: ProviderConfig[];
	selectedProvider: string;
	selectedModel: string;
	frontmatter: FrontmatterField[];
	classificationRule: string;
	codexConnection?: OAuthTokens;
	plugin_notices?: { muted: Record<string, boolean> };
}

// Re-export auth types for convenience
export type { OAuthTokens } from './auth';
