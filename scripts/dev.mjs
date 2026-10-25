#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import boiler from '../boiler.config.mjs';

const config = boiler.dev;

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  return undefined;
}

function getObsidianConfigPath() {
  const home = os.homedir();
  const platform = os.platform();
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'Obsidian', 'obsidian.json'),
      path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
    );
  } else if (platform === 'linux') {
    const xdg = process.env.XDG_CONFIG_HOME;
    const configBases = [xdg, path.join(home, '.config')].filter(Boolean);
    for (const base of configBases) {
      candidates.push(
        path.join(base, 'Obsidian', 'obsidian.json'),
        path.join(base, 'obsidian', 'obsidian.json'),
      );
    }
    candidates.push(path.join(home, '.obsidian', 'obsidian.json'));
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(
        path.join(appData, 'Obsidian', 'obsidian.json'),
        path.join(appData, 'obsidian', 'obsidian.json'),
      );
    }
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

function discoverVaults() {
  const configFile = getObsidianConfigPath();
  if (!configFile || !fs.existsSync(configFile)) {
    return [];
  }

  try {
    const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const vaults = data.vaults || {};

    return Object.values(vaults)
      .filter((vault) => vault.path && fs.existsSync(vault.path))
      .map((vault) => ({ name: path.basename(vault.path), path: vault.path }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`WARN Failed to parse Obsidian config at ${configFile}: ${error.message}`);
      return [];
    }
    throw error;
  }
}

function resolveVaultByNameOrPath(vaults, input) {
  const byName = vaults.find((vault) => vault.name === input);
  if (byName) {
    return [byName.path];
  }

  if (fs.existsSync(input)) {
    return [path.resolve(input)];
  }

  return [];
}

async function resolveVaults(vaults, options) {
  if (options.cliVaults) {
    return options.cliVaults.split(',').map((vaultPath) => path.resolve(vaultPath.trim()));
  }

  if (options.cliVault) {
    const resolved = resolveVaultByNameOrPath(vaults, options.cliVault);
    if (resolved.length > 0) {
      return resolved;
    }

    console.error(`Vault not found: ${options.cliVault}`);
    console.error(`Available: ${vaults.map((vault) => vault.name).join(', ') || '(none)'}`);
    process.exit(1);
  }

  if (process.env.VAULT_PATHS) {
    return process.env.VAULT_PATHS.split(',').map((vaultPath) => path.resolve(vaultPath.trim()));
  }

  if (process.env.VAULT_PATH) {
    return [path.resolve(process.env.VAULT_PATH)];
  }

  if (process.env.VAULT_NAME) {
    const resolved = resolveVaultByNameOrPath(vaults, process.env.VAULT_NAME);
    if (resolved.length > 0) {
      return resolved;
    }

    console.error(`Vault name not found: ${process.env.VAULT_NAME}`);
    process.exit(1);
  }

  if (vaults.length === 1) {
    console.log(`Auto-selecting vault: ${vaults[0].name}`);
    return [vaults[0].path];
  }

  if (options.nonInteractive) {
    console.error('Cannot determine vault in non-interactive mode.');
    console.error('Set VAULT_PATH, VAULT_NAME, or use --vault <name>');
    process.exit(1);
  }

  if (vaults.length === 0) {
    console.error('No Obsidian vaults found. Set VAULT_PATH env variable.');
    process.exit(1);
  }

  console.log('\nSelect Obsidian Vault for development:');
  for (const [index, vault] of vaults.entries()) {
    console.log(`  ${index + 1}) ${vault.name} (${vault.path})`);
  }

  const answer = await new Promise((resolve) => {
    const readLine = createInterface({ input: process.stdin, output: process.stdout });
    readLine.question('\nEnter number: ', (value) => {
      readLine.close();
      resolve(value.trim());
    });
  });

  const selectedIndex = Number.parseInt(answer, 10) - 1;
  if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= vaults.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }

  return [vaults[selectedIndex].path];
}

function copyStaticFiles(selectedVaults, pluginId, staticFiles) {
  for (const vaultPath of selectedVaults) {
    const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);
    fs.mkdirSync(pluginDir, { recursive: true });

    for (const file of staticFiles) {
      const sourceFile = path.resolve(process.cwd(), file.from);
      const destinationFile = path.join(pluginDir, file.to);
      if (!fs.existsSync(sourceFile)) {
        console.warn(`  WARN Skipped ${file.from} (file not found)`);
        continue;
      }

      fs.copyFileSync(sourceFile, destinationFile);
      console.log(`  Copied ${file.from} -> ${pluginDir}`);
    }

    const hotReloadDir = path.join(vaultPath, '.obsidian', 'plugins', 'hot-reload');
    if (!fs.existsSync(hotReloadDir)) {
      console.warn(`\nWARN hot-reload plugin not found in vault "${path.basename(vaultPath)}"`);
      console.warn('  Install from: https://github.com/pjeby/hot-reload');
      console.warn('  Continuing without hot-reload.\n');
    }

    fs.writeFileSync(path.join(pluginDir, '.hotreload'), '');
  }
}

function startFileSync(selectedVaults, pluginId, watchFiles) {
  const startWatch = (sourceFile, destinationName) => {
    let debounceTimer = null;
    fs.watch(sourceFile, () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        let hadError = false;
        for (const vaultPath of selectedVaults) {
          const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);
          const destinationFile = path.join(pluginDir, destinationName);

          try {
            fs.copyFileSync(sourceFile, destinationFile);
            fs.writeFileSync(path.join(pluginDir, '.hotreload'), String(Date.now()));
          } catch (error) {
            hadError = true;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Failed to copy ${sourceFile} -> ${destinationFile}: ${message}`);
          }
        }

        if (hadError) {
          console.warn(`[${new Date().toLocaleTimeString()}] Synced ${destinationName} with errors (see above)`);
        } else {
          console.log(`[${new Date().toLocaleTimeString()}] Synced ${destinationName} -> vault(s)`);
        }
      }, 100);
    });
  };

  const WAIT_TIMEOUT_MS = 30_000;

  for (const file of watchFiles) {
    const sourceFile = path.resolve(process.cwd(), file.from);
    const startTime = Date.now();

    const waitForFile = () => {
      if (fs.existsSync(sourceFile)) {
        console.log(`  Watching ${file.from} for changes`);
        startWatch(sourceFile, file.to);
        return;
      }

      if (Date.now() - startTime > WAIT_TIMEOUT_MS) {
        console.error(`ERROR Timed out waiting for ${file.from} to be created (${WAIT_TIMEOUT_MS / 1000}s)`);
        console.error('  Check that your build command produces this file.');
        return;
      }

      setTimeout(waitForFile, 500);
    };

    console.log(`  Waiting for ${file.from} to be created by build...`);
    waitForFile();
  }
}

async function main() {
  loadDotenv();

  const args = process.argv.slice(2);
  const options = {
    cliVault: getArg(args, '--vault'),
    cliVaults: getArg(args, '--vaults'),
    nonInteractive: args.includes('--non-interactive'),
    printVaults: args.includes('--print-vaults'),
  };

  const vaults = discoverVaults();
  if (options.printVaults) {
    console.log('Discovered Obsidian vaults:');
    for (const vault of vaults) {
      console.log(`  ${vault.name} -> ${vault.path}`);
    }
    if (vaults.length === 0) {
      console.log('  (none found)');
    }
    return;
  }

  const selectedVaults = await resolveVaults(vaults, options);
  console.log(`\nTarget vault(s): ${selectedVaults.join(', ')}`);

  const manifestPath = path.resolve(process.cwd(), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pluginId = manifest.id;
  console.log(`Plugin: ${pluginId}`);

  copyStaticFiles(selectedVaults, pluginId, config.deploy.staticFiles ?? []);

  const isDelegate = config.deploy.mode === 'delegate';
  const env = isDelegate
    ? { ...process.env, [config.deploy.envVar]: selectedVaults.join(',') }
    : process.env;

  console.log(
    isDelegate
      ? `\nStarting build (delegate mode, ${config.deploy.envVar}=${selectedVaults.join(',')})...\n`
      : '\nStarting build (copy mode)...\n',
  );

  const child = spawn(config.buildCommand[0], config.buildCommand.slice(1), {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });

  const cleanup = () => {
    child.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  if (isDelegate) {
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        process.exit(code);
      }
    });
    startFileSync(selectedVaults, pluginId, config.deploy.watchFiles ?? []);
  }
}

await main();
