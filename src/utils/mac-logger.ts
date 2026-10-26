import { PluginLogger } from './plugin-logger';

/**
 * Module-level logger for Metadata Auto Classifier.
 * Used by provider/lib layers that do not receive the plugin instance directly.
 */
let debugMode = false;

export const macLogger = new PluginLogger(() => debugMode);

export function setLoggerDebug(enabled: boolean): void {
	debugMode = enabled;
}
