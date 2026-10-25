import { ButtonComponent } from 'obsidian';

import { CODEX_OAUTH, formatTokenExpiry, isTokenExpired } from '../../auth';
import type { OAuthTokens } from '../../../types';
import { Setting } from './Setting';

export function renderOAuthSection(
	containerEl: HTMLElement,
	tokens: OAuthTokens | undefined,
	onConnect: () => void | Promise<void>,
	onDisconnect: () => void
): void {
	const connectedTokens = tokens && !isTokenExpired(tokens) ? tokens : undefined;
	const isConnected = Boolean(connectedTokens);
	const statusText = connectedTokens
		? `Connected (${formatTokenExpiry(connectedTokens)})`
		: 'Not connected';

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
		const infoEl = containerEl.createEl('div', {
			cls: 'setting-item-description oauth-connection-info',
		});
		infoEl.setCssProps({
			'margin-top': '-8px',
			'margin-bottom': '16px',
			'padding-left': '16px',
			color: 'var(--text-muted)',
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
