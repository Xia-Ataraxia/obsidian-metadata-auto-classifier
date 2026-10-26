import { App } from 'obsidian';
import { ModelSection } from '../../src/ui/settings/ModelSection';
import { ProviderModal } from '../../src/ui/settings/modals/ProviderModal';
import { Setting } from '../../src/ui/settings/components/Setting';
import { testModel } from '../../src/ui/provider-api';
import type AutoClassifierPlugin from '../../src/main';
import type { PluginNotices } from '../../src/ui/plugin-notices';

class TestElement {
	readonly children: TestElement[] = [];
	className = '';
	settingName = '';

	createDiv(options?: { cls?: string }): TestElement {
		const element = new TestElement();
		element.className = options?.cls ?? '';
		this.children.push(element);
		return element;
	}
}

vi.mock('obsidian', async (importOriginal) => {
	const sharedObsidian = await importOriginal<typeof import('obsidian')>();

	class TestSetting {
		readonly settingEl: TestElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = (containerEl as unknown as TestElement).createDiv({ cls: 'setting-item' });
		}
		setName(name: string): this {
			this.settingEl.settingName = name;
			return this;
		}
		setDesc(): this {
			return this;
		}
		setHeading(): this {
			this.settingEl.className = `${this.settingEl.className} setting-item-heading`;
			return this;
		}
	}

	return { ...sharedObsidian, Setting: TestSetting };
});

const { startAuthFlow } = vi.hoisted(() => ({ startAuthFlow: vi.fn() }));
vi.mock('../../src/ui/provider-api', () => ({ testModel: vi.fn() }));
vi.mock('../../src/ui/settings/components/Setting', () => ({ Setting: { create: vi.fn() } }));
vi.mock('../../src/ui/auth', () => ({
	CodexOAuth: class {
		startAuthFlow = startAuthFlow;
	},
	formatTokenExpiry: vi.fn(),
	isTokenExpired: vi.fn(),
	CODEX_OAUTH: {},
}));

const canary = 'synthetic-response-secret /private/synthetic-note';
beforeEach(() => vi.clearAllMocks());

describe('settings error privacy', () => {
	it('does not show a remote model-test exception', async () => {
		const show = vi.fn();
		const app = new App();
		const provider = {
			name: 'OpenAI',
			baseUrl: 'https://example.invalid',
			models: [{ id: 'test', name: 'Test' }],
		};
		const plugin = {
			settings: { selectedProvider: '', providers: [provider] },
			isActive: () => true,
			saveSettings: vi.fn().mockResolvedValue(undefined),
			notices: { show },
		} as unknown as AutoClassifierPlugin;
		const container = new TestElement();
		new ModelSection(plugin, app, vi.fn()).render(
			container as unknown as HTMLElement,
			[provider],
			''
		);
		const section = container.children[0];
		const heading = section?.children[0];
		expect(section?.className).toBe('model-section');
		expect(heading).toMatchObject({
			settingName: 'Models',
			className: 'setting-item setting-item-heading',
		});
		const action = vi
			.mocked(Setting.create)
			.mock.calls.flatMap((call) => call[1].buttons ?? [])
			.find((button) => button.text === 'Test');
		expect(action).toBeDefined();
		vi.mocked(testModel).mockRejectedValueOnce(new Error(canary));
		await action?.onClick();
		expect(show).toHaveBeenCalledWith('model_test_error', {
			name: 'Test',
			message: 'Request failed. Please try again.',
		});
		expect(JSON.stringify(show.mock.calls)).not.toContain(canary);
	});

	it('does not show an OAuth exception or unknown thrown payload', async () => {
		for (const failure of [new Error(canary), { message: canary }]) {
			const show = vi.fn();
			startAuthFlow.mockRejectedValueOnce(failure);
			const modal = new ProviderModal(new App(), vi.fn(), { show } as unknown as PluginNotices, {
				name: 'Codex',
				baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
				models: [],
				authType: 'oauth',
			});
			modal.onOpen();
			await (modal as unknown as { connectOAuth(): Promise<void> }).connectOAuth();
			expect(show).toHaveBeenCalledWith('oauth_failed', {
				message: 'Authentication could not be completed. Check the account configuration.',
			});
			expect(JSON.stringify(show.mock.calls)).not.toContain(canary);
		}
	});
});
