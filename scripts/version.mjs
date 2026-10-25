#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import boiler from '../boiler.config.mjs';

const version = process.env.npm_package_version;
if (!version) {
  throw new Error('npm_package_version is not set. Run via: pnpm version <semver>');
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = version;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, '\t')}\n`);

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[version] = minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, '\t')}\n`);

const stageFiles = boiler.version?.stageFiles ?? [];
if (stageFiles.length > 0) {
  const result = spawnSync('git', ['add', ...stageFiles], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to run git add: ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}
