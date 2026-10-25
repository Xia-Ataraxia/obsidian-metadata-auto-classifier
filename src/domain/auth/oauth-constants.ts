/**
 * Codex OAuth configuration constants
 * These values are specific to the OpenAI Codex API
 */

export const CODEX_OAUTH = {
	CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
	ISSUER: 'https://auth.openai.com',
	API_ENDPOINT: 'https://chatgpt.com/backend-api/codex/responses',
	TOKEN_ENDPOINT: 'https://auth.openai.com/oauth/token',
	DEVICE_USER_CODE_ENDPOINT: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
	DEVICE_TOKEN_ENDPOINT: 'https://auth.openai.com/api/accounts/deviceauth/token',
	DEVICE_VERIFICATION_URI: 'https://auth.openai.com/codex/device',
	DEVICE_CALLBACK_URI: 'https://auth.openai.com/deviceauth/callback',
	DEVICE_FLOW_TIMEOUT_MS: 15 * 60 * 1000,

	// Token refresh buffer (5 minutes before expiry)
	TOKEN_REFRESH_BUFFER_SECONDS: 300,
} as const;
