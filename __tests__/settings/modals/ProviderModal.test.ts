import type { Mock } from 'vitest';
import { App } from 'obsidian';
import { ProviderModal } from '../../../src/ui/settings/modals/ProviderModal';
import type { ProviderConfig } from '../../../src/types';

// Mock Notice
vi.mock('../../../src/ui/settings/components/Notice', () => ({
	Notice: {
		error: vi.fn(),
		success: vi.fn(),
		validationError: vi.fn(),
		formatValidationError: vi.fn((component, message) => `[${component}] ${message}`),
		startProgress: vi.fn(() => ({})),
		endProgress: vi.fn(),
	},
}));

// Mock lib
vi.mock('../../../src/utils/lib-utils', () => ({
	getProviderPresets: vi.fn().mockReturnValue([
		{
			name: 'OpenAI',
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			temperature: 0.7,
			apiKeyUrl: 'https://platform.openai.com/api-keys',
		},
		{
			name: 'Custom Provider',
			baseUrl: '',
			temperature: 0.7,
		},
	]),
	getProviderPreset: vi.fn().mockImplementation((name: string) => ({
		name,
		baseUrl: name === 'OpenAI' ? 'https://api.openai.com/v1/chat/completions' : '',
		temperature: 0.7,
	})),
}));

const mockNotices = {
	show: vi.fn(() => null),
	remove: vi.fn(),
	unload: vi.fn(),
} as any;

describe('ProviderModal', () => {
	let mockApp: App;
	let mockOnSave: Mock;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = new App();
		mockOnSave = vi.fn();
	});

	describe('Constructor', () => {
		it('should initialize with default values for new provider', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);

			expect(modal).toBeDefined();
			// Access private property via any cast
			const config = (modal as any).providerConfig;
			expect(config.name).toBe('Custom Provider');
			expect(config.apiKey).toBe('');
			expect(config.baseUrl).toBe('');
		});

		it('should initialize with existing values for edit mode', () => {
			const existingProvider: ProviderConfig = {
				name: 'My OpenAI',
				apiKey: 'sk-test-key',
				baseUrl: 'https://api.openai.com/v1/chat/completions',
				models: [],
				temperature: 0.7,
			};

			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices, existingProvider);

			const config = (modal as any).providerConfig;
			expect(config.name).toBe('My OpenAI');
			expect(config.apiKey).toBe('sk-test-key');
			expect(config.baseUrl).toBe('https://api.openai.com/v1/chat/completions');
		});

		it('deep-copies structured credentials and model settings for edit mode', () => {
			const existingProvider: ProviderConfig = {
				name: 'Structured OAuth',
				apiKey: 'legacy-key',
				baseUrl: 'https://api.example.com/v1/chat',
				models: [{ id: 'model-1', name: 'Model 1' }],
				temperature: 0.4,
				auth: {
					type: 'oauth',
					oauth: {
						accessToken: 'access-before-edit',
						refreshToken: 'refresh-before-edit',
						expiresAt: 1,
						accountId: 'account-1',
					},
				},
			};

			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices, existingProvider);
			const draft = (modal as any).providerConfig as ProviderConfig;
			if (draft.auth?.type === 'oauth') draft.auth.oauth.accessToken = 'edited-access';
			const draftModel = draft.models[0];
			if (!draftModel) throw new Error('Expected the copied provider model');
			draftModel.name = 'Edited Model';

			expect(existingProvider.auth).toMatchObject({
				type: 'oauth',
				oauth: { accessToken: 'access-before-edit' },
			});
			expect(existingProvider.models[0]?.name).toBe('Model 1');
		});
	});

	describe('onOpen', () => {
		it('should create modal structure with accessibility attributes', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			modal.onOpen();

			expect(modal.contentEl.empty).toHaveBeenCalled();
			expect(modal.contentEl.setAttribute).toHaveBeenCalledWith('role', 'dialog');
			expect(modal.contentEl.setAttribute).toHaveBeenCalledWith('aria-modal', 'true');
			expect(modal.contentEl.setAttribute).toHaveBeenCalledWith('aria-label', 'Provider settings');
			expect(modal.titleEl.textContent).toBe('Provider settings');
		});
	});

	describe('Form Validation', () => {
		it('should show error when provider name is empty', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			(modal as any).providerConfig.name = '   ';

			const result = (modal as any).validateForm();

			expect(result).toBe(false);
			expect(mockNotices.show).toHaveBeenCalledWith(
				'validation_error',
				expect.objectContaining({
					component: 'Provider',
					message: 'Enter a provider name.',
				})
			);
		});

		it('should show error when API URL is empty', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			(modal as any).providerConfig.name = 'OpenAI';
			(modal as any).providerConfig.baseUrl = '';

			const result = (modal as any).validateForm();

			expect(result).toBe(false);
			expect(mockNotices.show).toHaveBeenCalledWith(
				'validation_error',
				expect.objectContaining({
					component: 'Provider',
					message: 'Enter an API URL.',
				})
			);
		});

		it('should show error when API URL is invalid', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			(modal as any).providerConfig.name = 'OpenAI';
			(modal as any).providerConfig.baseUrl = 'not-a-valid-url';

			const result = (modal as any).validateForm();

			expect(result).toBe(false);
			expect(mockNotices.show).toHaveBeenCalledWith(
				'validation_error',
				expect.objectContaining({
					component: 'Provider',
					message: expect.stringContaining('valid URL'),
				})
			);
		});

		it('should pass validation when all fields are valid', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			(modal as any).providerConfig.name = 'OpenAI';
			(modal as any).providerConfig.baseUrl = 'https://api.example.com/v1/chat';

			const result = (modal as any).validateForm();

			expect(result).toBe(true);
		});

		it('accepts user-named providers without rewriting them', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			const config = (modal as any).providerConfig as ProviderConfig;
			config.name = 'Local Ollama';
			config.baseUrl = 'http://localhost:11434/v1/chat/completions';

			expect((modal as any).validateForm()).toBe(true);
			expect(config.name).toBe('Local Ollama');
		});
	});

	describe('onClose', () => {
		it('should clean up content element', () => {
			const modal = new ProviderModal(mockApp, mockOnSave, mockNotices);
			modal.onClose();

			expect(modal.contentEl.empty).toHaveBeenCalled();
		});
	});
});
