interface SyntheticSettingState {
	name: string;
	description: string;
	heading: boolean;
}

interface SyntheticTextInput {
	inputEl: { type: string };
	value: string;
	placeholder: string;
	callback?: (value: string) => unknown;
	setPlaceholder(placeholder: string): this;
	setValue(value: string): this;
	onChange(callback: (value: string) => unknown): this;
}

const settingHarness = vi.hoisted(() => ({
	settings: [] as SyntheticSettingState[],
	inputs: [] as SyntheticTextInput[],
	requestUrl: vi.fn(),
}));

vi.mock('obsidian', () => ({
	requestUrl: settingHarness.requestUrl,
	Setting: class {
		private readonly state = { name: '', description: '', heading: false };

		constructor(_containerEl: HTMLElement) {
			settingHarness.settings.push(this.state);
		}

		setName(name: string) {
			this.state.name = name;
			return this;
		}

		setDesc(description: string) {
			this.state.description = description;
			return this;
		}

		setHeading() {
			this.state.heading = true;
			return this;
		}

		addText(callback: (text: SyntheticTextInput) => void) {
			const input = {
				inputEl: { type: 'text' },
				value: '',
				placeholder: '',
				callback: undefined as ((value: string) => unknown) | undefined,
				setPlaceholder(placeholder: string) {
					this.placeholder = placeholder;
					return this;
				},
				setValue(value: string) {
					this.value = value;
					return this;
				},
				onChange(onChange: (value: string) => unknown) {
					this.callback = onChange;
					return this;
				},
			};
			settingHarness.inputs.push(input);
			callback(input);
			return this;
		}
	},
}));

import { requestUrl } from 'obsidian';
import type AutoClassifierPlugin from '../../src/main';
import { JevSection } from '../../src/ui/settings/JevSection';

const createPlugin = () => {
	const settings = {
		jev: { apiKey: 'existing-secret', model: 'jev-1.14.0' },
		providers: [{ name: 'provider' }],
		selectedProvider: 'provider',
		selectedModel: 'model',
		frontmatter: [{ id: 1, name: 'field' }],
		classificationRule: 'existing rules',
	};
	const saveSettings = vi.fn().mockResolvedValue(undefined);
	const plugin = { settings, saveSettings } as unknown as AutoClassifierPlugin;
	return { plugin, saveSettings };
};

const displaySection = (plugin: AutoClassifierPlugin): void => {
	new JevSection(plugin, { empty: vi.fn() } as unknown as HTMLElement).display();
};

const settingAt = (index: number): SyntheticSettingState => {
	const setting = settingHarness.settings[index];
	if (!setting) throw new Error(`Expected Jev setting at index ${index}`);
	return setting;
};

const inputAt = (index: number): SyntheticTextInput => {
	const input = settingHarness.inputs[index];
	if (!input) throw new Error(`Expected Jev text input at index ${index}`);
	return input;
};

const inputCallback = (input: SyntheticTextInput) => {
	const callback = input.callback;
	if (!callback) throw new Error('Expected Jev input callback to be registered');
	return callback;
};

describe('Jev settings section', () => {
	beforeEach(() => {
		settingHarness.settings.length = 0;
		settingHarness.inputs.length = 0;
		vi.mocked(requestUrl).mockClear();
	});

	test('renders a native heading and masked key/model inputs without transport calls', () => {
		const { plugin } = createPlugin();
		displaySection(plugin);

		expect(settingAt(0)).toEqual({
			name: 'Jev classification',
			description: 'Jev handles classification for all candidates.',
			heading: true,
		});
		expect(settingHarness.inputs).toHaveLength(2);
		const apiKeyInput = inputAt(0);
		const modelInput = inputAt(1);
		expect(apiKeyInput.inputEl.type).toBe('password');
		expect(apiKeyInput.value).toBe('existing-secret');
		expect(modelInput.inputEl.type).toBe('text');
		expect(modelInput.value).toBe('jev-1.14.0');
		expect(requestUrl).not.toHaveBeenCalled();
	});

	test('persists Jev changes without mutating other settings', async () => {
		const { plugin, saveSettings } = createPlugin();
		const { providers, selectedProvider, selectedModel, frontmatter, classificationRule } =
			plugin.settings;
		displaySection(plugin);

		const updateApiKey = inputCallback(inputAt(0));
		const updateModel = inputCallback(inputAt(1));
		await updateApiKey('new-secret');
		await updateModel('jev-custom');

		expect(plugin.settings.jev).toEqual({ apiKey: 'new-secret', model: 'jev-custom' });
		expect(plugin.settings.providers).toBe(providers);
		expect(plugin.settings.selectedProvider).toBe(selectedProvider);
		expect(plugin.settings.selectedModel).toBe(selectedModel);
		expect(plugin.settings.frontmatter).toBe(frontmatter);
		expect(plugin.settings.classificationRule).toBe(classificationRule);
		expect(saveSettings).toHaveBeenCalledTimes(2);
		expect(requestUrl).not.toHaveBeenCalled();
	});

	test('propagates save failures from input callbacks', async () => {
		const { plugin, saveSettings } = createPlugin();
		const error = new Error('settings save failed');
		saveSettings.mockRejectedValue(error);
		displaySection(plugin);

		await expect(inputCallback(inputAt(0))('new-secret')).rejects.toBe(error);
		expect(plugin.settings.jev.apiKey).toBe('new-secret');
		expect(requestUrl).not.toHaveBeenCalled();
	});
});
