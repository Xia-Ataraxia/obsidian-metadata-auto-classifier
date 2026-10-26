import { App, getFrontMatterInfo, TFile } from 'obsidian';
import { captureFieldBaseline, commitField } from '../../src/ui/frontmatter-commit';
import type { CommitFieldPlan } from '../../src/ui/frontmatter-commit';
import { FrontmatterEditError } from '../../src/domain/frontmatter-edit';
import type { Mock } from 'vitest';

type MockVault = {
	read: Mock<(file: TFile) => Promise<string>>;
	modify: Mock<(file: TFile, content: string) => Promise<void>>;
	process: Mock<(file: TFile, transform: (content: string) => string) => Promise<string>>;
};

const file = new TFile();

function plan(assertCurrent: () => void = vi.fn()): CommitFieldPlan {
	return {
		fieldName: 'tags',
		values: ['new'],
		overwrite: false,
		linkType: 'Normal',
		assertCurrent,
	};
}

function requireValue<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Expected ${label} to exist`);
	return value;
}

function appWithContent(content: string): App {
	const app = new App();
	vaultMocks(app).read.mockResolvedValue(content);
	return app;
}

function vaultMocks(app: App): MockVault {
	return app.vault as unknown as MockVault;
}

function injectContent(app: App, content: string): void {
	vaultMocks(app).process.mockImplementation(
		async (currentFile: TFile, transform: (value: string) => string) => {
			const updated = transform(content);
			await vaultMocks(app).modify(currentFile, updated);
			return updated;
		}
	);
}

function expectEditReason(action: () => unknown, reason: FrontmatterEditError['reason']): void {
	let caught: unknown;
	try {
		action();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(FrontmatterEditError);
	expect((caught as FrontmatterEditError).reason).toBe(reason);
}

describe('captureFieldBaseline', () => {
	beforeEach(() => vi.clearAllMocks());

	test('captures exact body and target type/value with a BOM and CRLF header', () => {
		const content = '\uFEFF---\r\ntags: old\r\n---\r\nBody\r\n';
		const baseline = captureFieldBaseline(content, 'tags');

		expect(baseline).toEqual({
			fieldName: 'tags',
			body: 'Body\r\n',
			target: { present: true, type: 'scalar', value: 'old' },
		});
		expect(getFrontMatterInfo).toHaveBeenCalledWith(content.slice(1));
	});

	test('captures arrays and scalar types without coercion', () => {
		const array = captureFieldBaseline('---\ntags: [one, 2, false, null]\n---\nBody', 'tags');
		const scalar = captureFieldBaseline('---\ntags: 2\n---\nBody', 'tags');

		expect(array.target).toEqual({
			present: true,
			type: 'array',
			value: ['one', 2, false, null],
		});
		expect(scalar.target).toEqual({ present: true, type: 'scalar', value: 2 });
	});

	test.each([
		['ordinary body', 'Body\n'],
		['unterminated delimiter', '---\r\nkey: value\r\nBody\r\n'],
	])('treats %s as body when the API mock reports no frontmatter', (_label, content) => {
		expect(captureFieldBaseline(content, 'tags')).toEqual({
			fieldName: 'tags',
			body: content,
			target: { present: false, type: 'missing' },
		});
	});

	test('captures an empty YAML header as frontmatter with a missing target', () => {
		expect(captureFieldBaseline('---\r\n---\r\nBody\r\n', 'tags')).toEqual({
			fieldName: 'tags',
			body: 'Body\r\n',
			target: { present: false, type: 'missing' },
		});
	});

	test('rejects malformed or unsafe target YAML with typed safe errors', () => {
		const malformed = '---\ntags: [broken\n---\nBody\n';
		const alias = '---\nsaved: &value old\ntags: *value\n---\nBody\n';

		expectEditReason(() => captureFieldBaseline(malformed, 'tags'), 'invalid-yaml');
		expectEditReason(() => captureFieldBaseline(alias, 'tags'), 'unsafe-target-reference');
	});
});

describe('commitField', () => {
	beforeEach(() => vi.clearAllMocks());

	test.each([
		['LF', '---\ntags: [old]\n---\nBody\n', '---\ntags: [old, new]\n---\nBody\n'],
		[
			'CRLF with BOM',
			'\uFEFF---\r\ntags: [old]\r\n---\r\nBody\r\n',
			'\uFEFF---\r\ntags: [old, new]\r\n---\r\nBody\r\n',
		],
	])(
		'commits one current-content transform preserving %s source boundaries',
		async (_label, content, expected) => {
			const app = appWithContent(content);
			const baseline = captureFieldBaseline(content, 'tags');

			await commitField(app, file, baseline, plan());

			expect(vaultMocks(app).process).toHaveBeenCalledTimes(1);
			expect(vaultMocks(app).modify).toHaveBeenCalledTimes(1);
			expect(vaultMocks(app).modify).toHaveBeenCalledWith(file, expected);
		}
	);

	test('creates a closed header for missing frontmatter and preserves BOM/body bytes', async () => {
		const content = '\uFEFFBody\r\nsecond line\r\n';
		const app = appWithContent(content);
		const baseline = captureFieldBaseline(content, 'tags');

		await commitField(app, file, baseline, plan());

		expect(vaultMocks(app).modify).toHaveBeenCalledWith(
			file,
			'\uFEFF---\r\ntags: [new]\r\n---\r\nBody\r\nsecond line\r\n'
		);
	});

	test('creates a closed header for an unterminated delimiter while retaining the entire original body', async () => {
		const content = '---\nunfinished: [value\nBody stays exact';
		const app = appWithContent(content);
		const baseline = captureFieldBaseline(content, 'tags');

		await commitField(app, file, baseline, plan());

		expect(vaultMocks(app).modify).toHaveBeenCalledWith(file, `---\ntags: [new]\n---\n${content}`);
	});

	test('adds the required EOL before the closer for an empty existing header', async () => {
		const content = '---\r\n---\r\nBody\r\n';
		const app = appWithContent(content);
		const baseline = captureFieldBaseline(content, 'tags');

		await commitField(app, file, baseline, plan());

		expect(vaultMocks(app).modify).toHaveBeenCalledWith(
			file,
			'---\r\ntags: [new]\r\n---\r\nBody\r\n'
		);
	});

	test('appends a missing field while preserving the current unrelated field', async () => {
		const content = '---\nother: current\n---\nBody\n';
		const app = appWithContent(content);

		await commitField(app, file, captureFieldBaseline(content, 'tags'), plan());

		expect(vaultMocks(app).modify).toHaveBeenCalledWith(
			file,
			'---\nother: current\ntags: [new]\n---\nBody\n'
		);
	});

	test('preserves unrelated current YAML edits and comments while appending the target', async () => {
		const baselineContent = '---\ntags: [old]\nother: initial\n---\nBody\n';
		const current = "---\ntags: [old]\nother: 'external' # keep me\n---\nBody\n";
		const app = appWithContent(baselineContent);
		injectContent(app, current);

		await commitField(app, file, captureFieldBaseline(baselineContent, 'tags'), plan());

		expect(vaultMocks(app).modify).toHaveBeenCalledWith(
			file,
			"---\ntags: [old, new]\nother: 'external' # keep me\n---\nBody\n"
		);
	});

	test('commits four existing plus three incoming values in stable order', async () => {
		const content = '---\ntags: [one, two, three, four]\n---\nBody\n';
		const app = appWithContent(content);
		const appendPlan = { ...plan(), values: ['five', 'six', 'seven'] };

		await commitField(app, file, captureFieldBaseline(content, 'tags'), appendPlan);

		expect(vaultMocks(app).modify).toHaveBeenCalledWith(
			file,
			'---\ntags: [one, two, three, four, five, six, seven]\n---\nBody\n'
		);
	});

	test('passes overwrite and WikiLink behavior into the pure source edit', async () => {
		const content = '---\ntags: [old]\n---\nBody\n';
		const app = appWithContent(content);
		const replacement = {
			...plan(),
			values: ['Page: section'],
			overwrite: true,
			linkType: 'WikiLink' as const,
		};

		await commitField(app, file, captureFieldBaseline(content, 'tags'), replacement);

		const modifyCall = requireValue(vaultMocks(app).modify.mock.calls[0], 'frontmatter write call');
		const updated = modifyCall[1];
		expect(captureFieldBaseline(updated, 'tags').target).toEqual({
			present: true,
			type: 'array',
			value: ['[[Page: section]]'],
		});
	});

	test.each([
		['body changed', 'body-conflict', '---\ntags: [old]\n---\nchanged body\n'],
		['target changed', 'target-conflict', '---\ntags: [current]\n---\nBody\n'],
		['target removed', 'target-conflict', '---\nother: keep\n---\nBody\n'],
		['target type changed', 'target-conflict', '---\ntags: old\n---\nBody\n'],
	] as const)('rejects when %s and performs no write', async (_label, reason, current) => {
		const original = '---\ntags: [old]\n---\nBody\n';
		const app = appWithContent(original);
		injectContent(app, current);

		await expect(
			commitField(app, file, captureFieldBaseline(original, 'tags'), plan())
		).rejects.toMatchObject({
			reason,
		});
		expect(vaultMocks(app).modify).not.toHaveBeenCalled();
	});

	test('rejects a target inserted after a baseline that recorded it as absent', async () => {
		const original = '---\nother: keep\n---\nBody\n';
		const current = '---\nother: keep\ntags: [external]\n---\nBody\n';
		const app = appWithContent(original);
		injectContent(app, current);

		await expect(
			commitField(app, file, captureFieldBaseline(original, 'tags'), plan())
		).rejects.toMatchObject({
			reason: 'target-conflict',
		});
		expect(vaultMocks(app).modify).not.toHaveBeenCalled();
	});

	test.each([
		['malformed', '---\ntags: [broken\n---\nBody\n'],
		['duplicate key', '---\ntags: [old]\ntags: [old]\n---\nBody\n'],
		['target alias', '---\nsaved: &item old\ntags: *item\n---\nBody\n'],
		['complex key after target', '---\ntags: [old]\n? [one, two]\n: value\n---\nBody\n'],
	] as const)('rejects %s current YAML without writing', async (_label, current) => {
		const original = '---\ntags: [old]\n---\nBody\n';
		const app = appWithContent(original);
		injectContent(app, current);

		await expect(
			commitField(app, file, captureFieldBaseline(original, 'tags'), plan())
		).rejects.toBeInstanceOf(FrontmatterEditError);
		expect(vaultMocks(app).modify).not.toHaveBeenCalled();
	});

	test.each(['renamed', 'revoked', 'unloaded', 'deadline'])(
		'runs the live %s guard inside the callback before transforming',
		async (label) => {
			const content = '---\ntags: [old]\n---\nBody\n';
			const app = appWithContent(content);
			const order: string[] = [];
			vaultMocks(app).process.mockImplementation(
				async (_file: TFile, transform: (value: string) => string) => {
					order.push('callback');
					return transform(content);
				}
			);
			const denied = new Error(`${label} guard`);
			const currentPlan = plan(() => {
				order.push('assertCurrent');
				throw denied;
			});

			await expect(
				commitField(app, file, captureFieldBaseline(content, 'tags'), currentPlan)
			).rejects.toBe(denied);
			expect(order).toEqual(['callback', 'assertCurrent']);
			expect(vaultMocks(app).modify).not.toHaveBeenCalled();
		}
	);

	test('checks plan field identity after the live guard and before writing', async () => {
		const content = '---\ntags: [old]\n---\nBody\n';
		const app = appWithContent(content);
		const guard = vi.fn();
		const wrongPlan = { ...plan(guard), fieldName: 'category' };

		await expect(
			commitField(app, file, captureFieldBaseline(content, 'tags'), wrongPlan)
		).rejects.toMatchObject({
			reason: 'field-mismatch',
		});
		expect(guard).toHaveBeenCalledTimes(1);
		expect(vaultMocks(app).modify).not.toHaveBeenCalled();
	});

	test('wraps process/save errors without exposing their message', async () => {
		const content = '---\ntags: [old]\n---\nBody\n';
		const app = appWithContent(content);
		vaultMocks(app).process.mockRejectedValue(new Error('private YAML content'));

		await expect(
			commitField(app, file, captureFieldBaseline(content, 'tags'), plan())
		).rejects.toMatchObject({
			name: 'FrontmatterCommitError',
			reason: 'process-failed',
			message: 'Frontmatter commit could not be completed safely',
		});
		expect(vaultMocks(app).modify).not.toHaveBeenCalled();
	});
});
