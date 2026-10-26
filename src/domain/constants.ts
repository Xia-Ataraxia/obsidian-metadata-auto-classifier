// ==========================================
// Consolidated Constants - All constants in one place
// ==========================================

import type {
	FrontmatterField,
	LinkType,
	ProviderConfig,
	AutoClassifierSettings,
	NoticeCatalog,
	StructuredFormat,
} from '../types';

// ==========================================
// Common Constants
// ==========================================

export const COMMON_CONSTANTS = {
	DEFAULT_MAX_TOKENS: 32000,
	DEFAULT_TEMPERATURE: 0.7,
	VERIFY_CONNECTION_SYSTEM_PROMPT: 'You are a test system. You must respond with valid JSON.',
	VERIFY_CONNECTION_USER_PROMPT: 'Return a JSON object containing {"tags": []}',
};

export const DEFAULT_PROVIDER: ProviderConfig = {
	name: 'OpenAI',
	apiKey: '',
	baseUrl: 'https://api.openai.com/v1/chat/completions',
	models: [
		{
			id: 'gpt-4.1-mini',
			name: 'GPT-4.1 Mini',
		},
	],
	temperature: COMMON_CONSTANTS.DEFAULT_TEMPERATURE,
};

export const TAG_GENERATION_SCHEMA = {
	type: 'object',
	properties: {
		tags: {
			type: 'array',
			items: { type: 'string' },
			description: 'New Obsidian tags only; do not repeat existing tags or candidates',
		},
	},
	required: ['tags'],
	additionalProperties: false,
} as const;

export const TAG_GENERATION_FORMAT: StructuredFormat = {
	name: 'generated_tags',
	schema: TAG_GENERATION_SCHEMA,
};

// ==========================================
// Default Settings
// ==========================================

// Semantic instructions only; the typed decision questions own the response contract.
export const DEFAULT_TASK_TEMPLATE = `<task>
Classify the following content using the provided reference categories.
</task>

<instructions>
1. Select only from the reference categories listed.
2. Judge relevance to the central subject, not incidental mentions.
3. Respect the user's field-specific instructions.
4. Preserve the meaning and specificity of hierarchical categories.
</instructions>
`;

export const DEFAULT_FRONTMATTER_SETTING = {
	name: '',
	count: { min: 1, max: 1 },
	refs: [],
	overwrite: false,
	linkType: 'WikiLink' as LinkType,
	customQuery: '',
	generateNewTags: false,
};

export const DEFAULT_TAG_SETTING: FrontmatterField = {
	id: 0,
	name: 'tags',
	refs: [],
	count: { min: 1, max: 5 },
	overwrite: false,
	linkType: 'Normal',
	customQuery: '',
	generateNewTags: false,
};

// ==========================================
// Notice Catalog — user-facing notification messages
// ==========================================

export const NOTICE_CATALOG: NoticeCatalog = {
	classification_status: {
		template: '{{message}}',
		timeout: 5000,
		immutable: true,
	},
	settings_save_failed: {
		template: 'Settings could not be saved. If sign-in stops working, connect your account again.',
		timeout: 8000,
	},
	classification_setup: {
		template: '{{message}}',
		timeout: 8000,
		action: 'open-settings',
	},
	// Error notices
	init_failed: {
		template: 'Could not set up commands. Reload the plugin to try again.',
		timeout: 5000,
	},
	no_active_file: {
		template: 'Open a note to classify first.',
		timeout: 5000,
	},
	no_frontmatter_setting: {
		template: 'This frontmatter no longer exists. Check your frontmatter list in settings.',
		timeout: 5000,
		action: 'open-settings',
	},
	validation_error: {
		template: '{{message}}',
		timeout: 5000,
		immutable: true,
	},
	no_refs: {
		template:
			'{{frontmatter}} has no reference values to choose from. Add some in settings.',
		timeout: 5000,
		action: 'open-settings',
	},
	oauth_connected: {
		template: 'Connected.',
		timeout: 3000,
		immutable: true,
	},
	oauth_cancelled: {
		template: 'Sign-in cancelled.',
		timeout: 3000,
		immutable: true,
	},
	oauth_failed: {
		template: 'Could not connect. {{message}}',
		timeout: 5000,
	},
	oauth_disconnected: {
		template: 'Disconnected.',
		timeout: 3000,
		immutable: true,
	},
	// Model section
	model_test_success: {
		template: '{{name}} is connected.',
		timeout: 3000,
		immutable: true,
	},
	model_test_error: {
		template: 'Test failed for {{name}}. {{message}}',
		timeout: 5000,
	},
};

// Default settings for the Auto Classifier plugin
export const DEFAULT_SETTINGS: AutoClassifierSettings = {
	providers: [DEFAULT_PROVIDER],
	selectedProvider: '',
	selectedModel: '',
	frontmatter: [DEFAULT_TAG_SETTING],
	classificationRule: DEFAULT_TASK_TEMPLATE,
};
