#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    output: '.github-release-body.md',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.output) {
    throw new Error('--output requires a file path');
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(typeof packageJson.version === 'string' && packageJson.version.length > 0, 'package.json is missing version');
  return packageJson.version;
}

function validateReleaseNotes(contents, version, filePath) {
  const trimmed = contents.trim();
  assert(trimmed.length > 0, `${filePath} is empty`);

  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim().length > 0) ?? '';
  if (firstLine.trim() === `# Release ${version}`) {
    assert(trimmed.includes('## Summary'), `${filePath} must include a "## Summary" section`);
    return `${trimmed}\n`;
  }

  return normalizeLegacyReleaseNotes(trimmed, version, filePath);
}

function normalizeLegacyReleaseNotes(contents, version, filePath) {
  const lines = contents.split(/\r?\n/);
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);
  const firstLine = firstNonEmptyIndex >= 0 ? lines[firstNonEmptyIndex].trim() : '';
  const versionTokens = [version, `v${version}`];

  assert(
    versionTokens.some((token) => firstLine.includes(token)),
    `${filePath} must start with "# Release ${version}" or a legacy heading that mentions ${version}`,
  );

  const remaining = lines
    .slice(firstNonEmptyIndex + 1)
    .join('\n')
    .trim();

  if (!remaining) {
    return buildFallbackNotes(version);
  }

  if (remaining.startsWith('## Summary')) {
    return `# Release ${version}\n\n${remaining}\n`;
  }

  return `# Release ${version}\n\n## Summary\n${remaining}\n`;
}

function buildFallbackNotes(version) {
  return [
    `# Release ${version}`,
    '',
    '## Summary',
    `- Automated release for ${version}.`,
    '',
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = loadCurrentVersion();
  const releasesDir = path.join(process.cwd(), 'releases');
  const releaseNotesPath = path.join(releasesDir, `${version}.md`);

  let body = buildFallbackNotes(version);
  if (fs.existsSync(releaseNotesPath)) {
    body = validateReleaseNotes(fs.readFileSync(releaseNotesPath, 'utf8'), version, releaseNotesPath);
  }

  fs.writeFileSync(options.output, body);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
