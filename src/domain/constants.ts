// ==========================================
// Consolidated Constants - All constants in one place
// ==========================================

import type {
	FrontmatterField,
	LinkType,
	ProviderConfig,
	AutoClassifierSettings,
	NoticeCatalog,
} from '../types';

// ==========================================
// Common Constants
// ==========================================

export const COMMON_CONSTANTS = {
	DEFAULT_MAX_TOKENS: 32000,
	DEFAULT_RELIABILITY_MIN: 0,
	DEFAULT_RELIABILITY_MAX: 1,
	DEFAULT_TEMPERATURE: 0.7,
	MIN_RELIABILITY_THRESHOLD: 0.2,
	VERIFY_CONNECTION_SYSTEM_PROMPT: 'You are a test system. You must respond with valid JSON.',
	VERIFY_CONNECTION_USER_PROMPT: 'Return a JSON object containing {"output": [], "reliability": 0}',
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

// Common Schema Base (reused by OpenAI, OpenRouter, Gemini)
export const COMMON_SCHEMA_BASE = {
	type: 'object',
	properties: {
		output: {
			type: 'array',
			items: { type: 'string' },
			description: 'Array of classified tags or categories',
		},
		reliability: {
			type: 'number',
			description: 'A number between 0 and 1 indicating confidence in the classification',
		},
	},
	required: ['output', 'reliability'],
	additionalProperties: false,
} as const;

// Anthropic Configuration
export const ANTHROPIC_TOOL_CONFIG = {
	name: 'classify_content',
	description: 'Classify content and return structured metadata',
	input_schema: {
		type: 'object',
		properties: {
			output: {
				type: 'array',
				items: { type: 'string' },
				description: 'Array of classification tags or metadata values',
			},
			reliability: {
				type: 'number',
				minimum: COMMON_CONSTANTS.DEFAULT_RELIABILITY_MIN,
				maximum: COMMON_CONSTANTS.DEFAULT_RELIABILITY_MAX,
				description: 'Confidence score from 0 to 1',
			},
		},
		required: ['output', 'reliability'],
	},
};

// OpenAI Configuration
export const OPENAI_STRUCTURE_OUTPUT = {
	type: 'json_schema',
	json_schema: {
		name: 'metadata_classifier',
		schema: COMMON_SCHEMA_BASE,
		strict: true,
	},
};

// LMStudio Configuration
export const LMSTUDIO_STRUCTURE_OUTPUT = {
	type: 'json_schema',
	json_schema: {
		name: 'structured_output',
		strict: true,
		schema: {
			type: 'object',
			properties: {
				output: {
					type: 'array',
					items: { type: 'string' },
				},
				reliability: {
					type: 'number',
				},
			},
			required: ['output', 'reliability'],
		},
	},
};

// Gemini Configuration
export const GEMINI_STRUCTURE_OUTPUT = {
	response_mime_type: 'application/json',
	response_schema: {
		type: 'object',
		properties: {
			output: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Pick only from the reference list. Match exactly, including case and slashes.\n' +
					'Valid: ["technology/ai"]\n' +
					'Invalid: ["string"], ["Technology"], ["technology - ai"]',
			},
			reliability: {
				type: 'number',
				description:
					'Float between 0 and 1. Do not exceed 1. Use lower value if uncertain.\n' +
					'Valid: 0.83\n' +
					'Invalid: 1.23, "high"',
			},
		},
		required: ['output', 'reliability'],
	},
};

// Ollama Configuration (Native API)
export const OLLAMA_STRUCTURE_OUTPUT = {
	type: 'object',
	properties: {
		output: {
			type: 'array',
			items: { type: 'string' },
			description: 'Array of classified tags or categories from the reference list',
		},
		reliability: {
			type: 'number',
			minimum: COMMON_CONSTANTS.DEFAULT_RELIABILITY_MIN,
			maximum: COMMON_CONSTANTS.DEFAULT_RELIABILITY_MAX,
			description: 'Confidence score between 0 and 1',
		},
	},
	required: ['output', 'reliability'],
	additionalProperties: false,
};

// ==========================================
// Default Settings
// ==========================================

// Prompt template
export const DEFAULT_TASK_TEMPLATE = `<task>
Classify the following content using the provided reference categories.
</task>

<instructions>
1. Select only from the reference categories listed.
2. Preserve the exact formatting of the reference categories, including brackets.
3. Assign a "reliability" score between 0 and 1 to each selected category, indicating confidence in the classification.
4. Maintain the full hierarchical structure for nested categories. (e.g. category/subcategory)
</instructions>

<plain_example>
{
	"output": ["machine learning", "natural language processing"],
	"reliability": 0.87
}
</plain_example>
<wikilink_example>
{
	"output": ["[[Large Language Model]]", "[[Prompt Engineering]]"],
	"reliability": 0.92
}
</wikilink_example>
`;

export const DEFAULT_FRONTMATTER_SETTING = {
	name: '',
	count: { min: 1, max: 1 },
	refs: [],
	overwrite: false,
	linkType: 'WikiLink' as LinkType,
	customQuery: '',
};

export const DEFAULT_TAG_SETTING: FrontmatterField = {
	id: 0,
	name: 'tags',
	refs: [],
	count: { min: 1, max: 5 },
	overwrite: false,
	linkType: 'Normal',
	customQuery: '',
};

// ==========================================
// Notice Catalog — user-facing notification messages
// ==========================================

export const NOTICE_CATALOG: NoticeCatalog = {
	// Error notices
	init_failed: {
		template: 'Could not set up commands. Reload the plugin to try again.',
		timeout: 5000,
	},
	no_active_file: {
		template: 'No active file.',
		timeout: 5000,
	},
	no_provider_selected: {
		template: 'No provider selected. Select one in settings.',
		timeout: 5000,
		action: 'open-settings',
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
	api_error: {
		template: '{{message}}',
		timeout: 5000,
	},
	low_reliability: {
		template: '{{file}} ({{frontmatter}}): skipped, low reliability ({{reliability}}).',
		timeout: 5000,
	},
	no_refs: {
		template:
			'{{frontmatter}} has no reference values to choose from. Add some in settings.',
		timeout: 5000,
		action: 'open-settings',
	},
	no_auth: {
		template: '{{message}}',
		timeout: 5000,
	},
	no_model: {
		template: 'No model selected. Select one in settings.',
		timeout: 5000,
		action: 'open-settings',
	},
	model_not_for_provider: {
		template:
			'{{model}} is not available for {{provider}}. Select another model in settings.',
		timeout: 5000,
		action: 'open-settings',
	},
	// Success notices
	classify_success: {
		template: '{{message}}',
		timeout: 3000,
		immutable: true,
	},
	// Auth notices
	oauth_opening_browser: {
		template: 'Opening your browser to sign in…',
		timeout: 3000,
		immutable: true,
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
