import { ButtonComponent } from 'obsidian';

import { CODEX_OAUTH, formatTokenExpiry, isTokenExpired } from '../../auth';
import type { OAuthTokens } from '../../../types';
import { Setting } from './Setting';

export function renderOAuthSection(
	containerEl: HTMLElement,
	tokens: OAuthTokens | undefined,
	onConnect: () => void | Promise<void>,
	onDisconnect: () => void | Promise<void>
): void {
	const isConnected = Boolean(tokens?.refreshToken) || (tokens !== undefined && !isTokenExpired(tokens));
	const statusText =
		tokens && !isTokenExpired(tokens)
			? `Connected (${formatTokenExpiry(tokens)})`
			: 'Connected, refreshes on next use';

	Setting.create(containerEl, {
		name: 'Authentication',
		desc: isConnected ? statusText : 'Connect your account to use this provider',
		button: {
			text: isConnected ? 'Disconnect' : 'Connect Account',
			warning: isConnected,
			onClick: isConnected ? onDisconnect : onConnect,
		},
	});

	if (!isConnected) {
		const infoEl = containerEl.createDiv({
			cls: 'setting-item-description oauth-connection-info',
		});
		infoEl.textContent = 'Device-code sign-in may be disabled by account or workspace settings.';
	}
}

export function renderOAuthDeviceCode(
	containerEl: HTMLElement,
	userCode: string,
	onOpenVerificationPage: () => void
): void {
	const section = containerEl.createDiv({ cls: 'oauth-device-code' });
	section.createEl('p', {
		text: `Enter this one-time code at ${CODEX_OAUTH.DEVICE_VERIFICATION_URI}.`,
	});
	section.createEl('code', { text: userCode });
	new ButtonComponent(section)
		.setButtonText('Open verification page')
		.onClick(onOpenVerificationPage);
}
