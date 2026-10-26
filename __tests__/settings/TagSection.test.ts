interface SyntheticElement {
	children: unknown[];
	empty(): void;
	createDiv(...args: unknown[]): SyntheticElement;
	createEl(...args: unknown[]): SyntheticElement;
	addClass(...args: unknown[]): void;
	setAttribute(...args: unknown[]): void;
}

interface SyntheticTextInput {
	inputEl: { type: string; disabled?: boolean; classList: { add(...args: unknown[]): void } };
	value: string;
	placeholder: string;
	setPlaceholder(value: string): this;
	setValue(value: string): this;
	onChange(callback: (value: string) => unknown): this;
	callback?: (value: string) => unknown;
}

interface SyntheticToggle {
	value: boolean;
	setValue(value: boolean): this;
	onChange(callback: (value: boolean) => unknown): this;
	callback?: (value: boolean) => unknown;
}

interface SyntheticButton {
	text: string;
	buttonEl: { setAttribute(...args: unknown[]): void };
	setButtonText(value: string): this;
	setCta(): this;
	setDisabled(value: boolean): this;
	setIcon(value: string): this;
	setTooltip(value: string): this;
	onClick(callback: () => unknown): this;
	callback?: () => unknown;
}

interface SyntheticSlider {
	setLimits(...args: unknown[]): this;
	setValue(...args: unknown[]): this;
	onChange(...args: unknown[]): this;
}

const settingHarness = vi.hoisted(() => ({
	textInputs: [] as { name: string; component: SyntheticTextInput }[],
	toggles: [] as {
		name: string;
		container: SyntheticElement;
		setting: { settingEl: { visible: boolean } };
		component: SyntheticToggle;
	}[],
	buttons: [] as { component: SyntheticButton }[],
	modals: [] as unknown[],
}));

vi.mock('obsidian', () => {
	function createElement(): SyntheticElement {
		const children: unknown[] = [];
		return {
			children,
			empty: () => (children.length = 0),
			createDiv: () => {
				const child = createElement();
				children.push(child);
				return child;
			},
			createEl: () => {
				const child = createElement();
				children.push(child);
				return child;
			},
			addClass: () => {},
			setAttribute: () => {},
		};
	}

	const makeTextInput = (): SyntheticTextInput => ({
		inputEl: { type: 'text', classList: { add: () => {} } },
		value: '',
		setPlaceholder(value) {
			this.placeholder = value;
			return this;
		},
		setValue(value) {
			this.value = value;
			return this;
		},
		onChange(callback) {
			this.callback = callback;
			return this;
		},
		placeholder: '',
	});

	const makeToggle = (): SyntheticToggle => ({
		value: false,
		setValue(value) {
			this.value = value;
			return this;
		},
		onChange(callback) {
			this.callback = callback;
			return this;
		},
	});

	const makeButton = (): SyntheticButton => ({
		text: '',
		buttonEl: { setAttribute: () => {} },
		setButtonText(value) {
			this.text = value;
			return this;
		},
		setCta() {
			return this;
		},
		setDisabled() {
			return this;
		},
		setIcon() {
			return this;
		},
		setTooltip() {
			return this;
		},
		onClick(callback) {
			this.callback = callback;
			return this;
		},
	});

	class Setting {
		settingEl = {
			visible: true,
			addClass: () => {},
			createDiv: () => createElement(),
			toggle(show: boolean) {
				this.visible = show;
			},
		};
		controlEl = { createSpan: () => createElement() };
		name = '';

		constructor(private readonly container: SyntheticElement) {
			container.children.push(this);
		}

		setName(name: string) {
			this.name = name;
			return this;
		}

		setDesc() {
			return this;
		}

		setHeading() {
			return this;
		}

		addText(callback: (input: SyntheticTextInput) => void) {
			const component = makeTextInput();
			settingHarness.textInputs.push({ name: this.name, component });
			callback(component);
			return this;
		}

		addToggle(callback: (input: SyntheticToggle) => void) {
			const component = makeToggle();
			settingHarness.toggles.push({
				name: this.name,
				container: this.container,
				setting: this,
				component,
			});
			callback(component);
			return this;
		}

		addSlider(callback: (input: SyntheticSlider) => void) {
			const input: SyntheticSlider = {
				setLimits: () => input,
				setValue: () => input,
				onChange: () => input,
			};
			callback(input);
			return this;
		}

		addButton(callback: (button: SyntheticButton) => void) {
			const component = makeButton();
			settingHarness.buttons.push({ component });
			callback(component);
			return this;
		}

		addExtraButton(callback: (button: SyntheticButton) => void) {
			callback(makeButton());
			return this;
		}
	}

	class Modal {
		contentEl = createElement();
		close = vi.fn();
		open = vi.fn();

		constructor(_app: unknown) {
			settingHarness.modals.push(this);
		}

		setTitle() {}
	}

	class TextAreaComponent {
		private readonly classes = new Set<string>();
		inputEl = {
			rows: 0,
			addClass: (...names: string[]) => { for (const name of names) this.classes.add(name); },
			hasClass: (name: string) => this.classes.has(name),
		};
		setPlaceholder() {
			return this;
		}
		setValue() {
			return this;
		}
		onChange() {
			return this;
		}
	}

	return {
		Modal,
		Setting,
		TextAreaComponent,
		TextComponent: class {},
		ExtraButtonComponent: class {},
	};
});

vi.mock('../../src/ui/settings/components/Notice', () => ({
	Notice: { startProgress: vi.fn(() => ({})), endProgress: vi.fn() },
}));
vi.mock('../../src/ui/settings/components/WikiLinkSelector', () => ({
	WikiLinkSelector: class {},
}));

import type { FrontmatterField } from '../../src/types';
import { DEFAULT_TAG_SETTING } from '../../src/domain/constants';
import { deepCloneFrontmatterField } from '../../src/ui/frontmatter';
import { Tag } from '../../src/ui/settings/TagSection';
import { ConfigurableSettingModal } from '../../src/ui/settings/modals/FrontmatterEditorModal';

const createField = (name: string, flag: unknown, id = 0): FrontmatterField => ({
	...DEFAULT_TAG_SETTING,
	id,
	name,
	generateNewTags: flag as boolean,
});

const createModal = (field: FrontmatterField): ConfigurableSettingModal =>
	new ConfigurableSettingModal({} as never, {
		frontmatterSetting: field,
		options: { showLinkType: false, showOptions: false, showTextArea: false },
		onSave: vi.fn().mockResolvedValue(undefined),
	});

const activeGenerationToggles = () =>
	settingHarness.toggles.filter(
		({ name, container, setting }) =>
			name === 'Generate new tags' &&
			container.children.includes(setting) &&
			setting.settingEl.visible
	);

const currentModal = (): ConfigurableSettingModal => {
	const modal = settingHarness.modals[0];
	if (!(modal instanceof ConfigurableSettingModal))
		throw new Error('Expected the tag editor modal to be created');
	return modal;
};

const saveChanges = async (): Promise<void> => {
	const saveButton = settingHarness.buttons.find(({ component }) => component.text === 'Save');
	if (!saveButton) throw new Error('Expected the tag editor save button to be rendered');
	const onSave = saveButton.component.callback;
	if (!onSave) throw new Error('Expected the tag editor save callback to be registered');
	await onSave();
};

const createTagContainer = () => {
	const createElement = () => {
		const children: unknown[] = [];
		return {
			children,
			empty: () => (children.length = 0),
			createEl: () => createElement(),
			createDiv: () => createElement(),
		};
	};
	return createElement();
};

beforeEach(() => {
	settingHarness.textInputs.length = 0;
	settingHarness.toggles.length = 0;
	settingHarness.buttons.length = 0;
	settingHarness.modals.length = 0;
});

describe('Tag generation eligibility', () => {
	test.each([
		{ name: 'tags', id: 42, flag: true, expected: true, visible: true },
		{ name: 'tags', id: 0, flag: false, expected: false, visible: true },
		{ name: 'tags', id: 0, flag: 'true', expected: false, visible: true },
		{ name: 'kind', id: 0, flag: true, expected: false, visible: false },
		{ name: 'Tags', id: 0, flag: true, expected: false, visible: false },
		{ name: 'tags ', id: 0, flag: true, expected: false, visible: false },
	])(
		'honors only exact tags name and boolean true: $name / $flag',
		({ name, id, flag, expected, visible }) => {
			const field = createField(name, flag, id);
			expect(deepCloneFrontmatterField(field).generateNewTags).toBe(expected);

			createModal(field).onOpen();
			const toggles = activeGenerationToggles();
			expect(toggles).toHaveLength(visible ? 1 : 0);
			if (visible) {
				const toggle = toggles[0];
				if (!toggle) throw new Error('Expected the generation permission toggle to be rendered');
				expect(toggle.component.value).toBe(expected);
			}
		}
	);

	test('toggle saves through the existing tag modal', async () => {
		const tagField = createField('tags', false);
		const plugin = {
			app: { vault: { getMarkdownFiles: vi.fn() } },
			settings: { frontmatter: [tagField] },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tagSection = new Tag(plugin as never, createTagContainer() as never);
		(tagSection as any).handleEdit(tagField);
		const modal = currentModal();
		modal.onOpen();

		const toggle = activeGenerationToggles()[0];
		if (!toggle) throw new Error('Expected the generation permission toggle to be rendered');
		const setGenerationPermission = toggle.component.callback;
		if (!setGenerationPermission)
			throw new Error('Expected the generation permission callback to be registered');
		setGenerationPermission(true);
		await saveChanges();
		const savedField = plugin.settings.frontmatter[0];
		if (!savedField) throw new Error('Expected the edited tag field to remain in settings');
		expect(savedField.generateNewTags).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	test('renaming away from exact tags removes and clears generation permission', async () => {
		const tagField = createField('tags', true);
		const plugin = {
			app: { vault: { getMarkdownFiles: vi.fn() } },
			settings: { frontmatter: [tagField] },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tagSection = new Tag(plugin as never, createTagContainer() as never);
		(tagSection as any).handleEdit(tagField);
		const modal = currentModal();
		modal.onOpen();

		const nameInput = settingHarness.textInputs.find(({ name }) => name === 'Name');
		if (!nameInput) throw new Error('Expected the tag-name input to be rendered');
		const updateName = nameInput.component.callback;
		if (!updateName) throw new Error('Expected the tag-name callback to be registered');
		updateName('Tags');
		expect(activeGenerationToggles()).toHaveLength(0);
		await saveChanges();
		const savedField = plugin.settings.frontmatter[0];
		if (!savedField) throw new Error('Expected the renamed tag field to remain in settings');
		expect(savedField.name).toBe('Tags');
		expect(savedField.generateNewTags).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	test('ordinary id-zero fields never persist a stored true flag', async () => {
		const field = createField('kind', true, 0);
		const plugin = {
			app: { vault: { getMarkdownFiles: vi.fn() } },
			settings: { frontmatter: [field] },
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
		const tagSection = new Tag(plugin as never, createTagContainer() as never);
		(tagSection as any).handleEdit(field);
		const modal = currentModal();
		modal.onOpen();

		expect(activeGenerationToggles()).toHaveLength(0);
		await saveChanges();
		const savedField = plugin.settings.frontmatter[0];
		if (!savedField) throw new Error('Expected the ordinary field to remain in settings');
		expect(savedField.generateNewTags).toBe(false);
	});
});
