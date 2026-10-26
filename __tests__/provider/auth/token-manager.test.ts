import {
	parseJwtClaims,
	extractAccountId,
	isTokenExpired,
	createTokensFromResponse,
	getTokenRemainingTime,
	formatTokenExpiry,
} from '../../../src/domain/auth/token-manager';
import type { OAuthTokens, TokenResponse } from '../../../src/types/auth';

const mockNow = 1700000000000;
const nowSeconds = mockNow / 1000;
const futureExpiry = nowSeconds + 3600;
const authNamespace = 'https://api.openai.com/auth';

function encodeBytes(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeJson(value: unknown): string {
	return encodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function jwt(claims: unknown, header: unknown = { alg: 'RS256', typ: 'JWT' }): string {
	return `${encodeJson(header)}.${encodeJson(claims)}.c2ln`;
}

function claimsWithAccount(
	accountId: unknown,
	exp: unknown = futureExpiry
): Record<string, unknown> {
	return { exp, [authNamespace]: { chatgpt_account_id: accountId } };
}

function responseFor(
	accessToken = jwt(claimsWithAccount('workspace-123'))
): Record<string, unknown> {
	return { access_token: accessToken, refresh_token: 'refresh-token-123' };
}

function tokensWithExpiry(expiresAt: number): OAuthTokens {
	return { accessToken: 'token', refreshToken: 'refresh', expiresAt, accountId: 'workspace-123' };
}

describe('token-manager', () => {
	beforeEach(() => {
		vi.spyOn(Date, 'now').mockReturnValue(mockNow);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('parseJwtClaims', () => {
		it('parses strict base64url JWT objects with Unicode claims', () => {
			const claims = { name: 'Jóhn 雪', nested: { value: '東京' } };
			expect(parseJwtClaims(jwt(claims))).toEqual(claims);
		});

		it.each(['one.two', 'a.b.c.d', '!.e30.c2ln', `${encodeJson({ alg: 'RS256' })}.e30.*`])(
			'rejects malformed JWT envelope %s with a fixed error',
			(token) => {
				expect(() => parseJwtClaims(token)).toThrow('Invalid JWT');
			}
		);

		it.each(['[]', 'null', '"string"', '42'])('rejects non-object JWT payload %s', (payload) => {
			expect(() =>
				parseJwtClaims(`${encodeJson({ alg: 'RS256' })}.${encodeJson(JSON.parse(payload))}.c2ln`)
			).toThrow('Invalid JWT');
		});

		it('rejects invalid UTF-8 and malformed JSON payloads', () => {
			const invalidUtf8 = encodeBytes(new Uint8Array([0xc0]));
			const invalidJson = encodeBytes(new TextEncoder().encode('{not-json'));
			const header = encodeJson({ alg: 'RS256' });
			expect(() => parseJwtClaims(`${header}.${invalidUtf8}.c2ln`)).toThrow('Invalid JWT');
			expect(() => parseJwtClaims(`${header}.${invalidJson}.c2ln`)).toThrow('Invalid JWT');
		});
	});

	describe('extractAccountId', () => {
		it('selects chatgpt_account_id rather than user_id, chatgpt_user_id, or sub', () => {
			const accessToken = jwt({
				exp: futureExpiry,
				[authNamespace]: {
					chatgpt_account_id: 'workspace-123',
					chatgpt_user_id: 'person-456',
					user_id: 'person-789',
				},
				sub: 'subject-abc',
			});
			expect(extractAccountId(accessToken)).toBe('workspace-123');
		});

		it.each([
			{ [authNamespace]: { user_id: 'person-123' }, sub: 'subject-123' },
			{ [authNamespace]: { chatgpt_user_id: 'person-123' }, sub: 'subject-123' },
			{ sub: 'subject-123' },
		])('does not substitute user identity claims for a missing account ID', (claims) => {
			expect(() => extractAccountId(jwt(claims))).toThrow('Invalid token account ID');
		});

		it.each([null, 42, {}, ['workspace-123']])('rejects non-string account IDs %s', (accountId) => {
			expect(() => extractAccountId(jwt(claimsWithAccount(accountId)))).toThrow(
				'Invalid token account ID'
			);
		});

		it.each([
			'',
			'  ',
			'workspace\r\nX-Injected: yes',
			' workspace',
			'work space',
			'workspace\u2028',
		])('rejects unsafe account IDs', (accountId) => {
			expect(() => extractAccountId(jwt(claimsWithAccount(accountId)))).toThrow(
				'Invalid token account ID'
			);
		});
	});

	describe('createTokensFromResponse', () => {
		it('accepts the optional-field-free response and uses the access JWT expiry', () => {
			const accessToken = jwt(claimsWithAccount('workspace-123'));
			const response: TokenResponse = {
				access_token: accessToken,
				refresh_token: 'refresh-token-123',
			};

			expect(createTokensFromResponse(response)).toEqual({
				accessToken,
				refreshToken: 'refresh-token-123',
				expiresAt: futureExpiry,
				accountId: 'workspace-123',
			});
		});

		it('requires a matching account ID in an optional ID token', () => {
			const response = responseFor();
			response.id_token = jwt(claimsWithAccount('workspace-123'));
			response.token_type = 'bEaReR';
			expect(createTokensFromResponse(response).accountId).toBe('workspace-123');

			response.id_token = jwt({ sub: 'workspace-123' });
			expect(() => createTokensFromResponse(response)).toThrow('Invalid token account ID');
		});

		it('rejects mismatched or missing ID-token account claims', () => {
			const mismatch = responseFor();
			mismatch.id_token = jwt(claimsWithAccount('another-workspace'));
			expect(() => createTokensFromResponse(mismatch)).toThrow('Invalid token account ID');

			const missing = responseFor();
			missing.id_token = jwt({ sub: 'workspace-123' });
			expect(() => createTokensFromResponse(missing)).toThrow('Invalid token account ID');
		});

		it('never allows an ID token to substitute for the access-token account claim', () => {
			const response = responseFor(jwt({ exp: futureExpiry, sub: 'person-123' }));
			response.id_token = jwt(claimsWithAccount('workspace-123'));
			expect(() => createTokensFromResponse(response)).toThrow('Invalid token account ID');
		});

		it('uses expires_in only when it shortens the access JWT expiry', () => {
			const shorter = responseFor();
			shorter.expires_in = 900;
			expect(createTokensFromResponse(shorter).expiresAt).toBe(nowSeconds + 900);

			const longer = responseFor();
			longer.expires_in = 7200;
			expect(createTokensFromResponse(longer).expiresAt).toBe(futureExpiry);
		});

		it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '3600'])(
			'rejects invalid expires_in %s',
			(expiresIn) => {
				const response = responseFor();
				response.expires_in = expiresIn;
				expect(() => createTokensFromResponse(response)).toThrow('Invalid token response');
			}
		);

		it.each([undefined, null, Number.POSITIVE_INFINITY, '1700003600', 1700000000, 1700003600.5])(
			'rejects missing, invalid, or non-future access JWT exp %s',
			(exp) => {
				const response = responseFor(jwt({ ...claimsWithAccount('workspace-123'), exp }));
				expect(() => createTokensFromResponse(response)).toThrow('Invalid token expiry');
			}
		);

		it('rejects invalid token types and non-object responses', () => {
			for (const tokenType of ['Basic', '', 7, null]) {
				const response = responseFor();
				response.token_type = tokenType;
				expect(() => createTokensFromResponse(response)).toThrow('Invalid token response');
			}
			expect(() => createTokensFromResponse(null)).toThrow('Invalid token response');
			expect(() => createTokensFromResponse([])).toThrow('Invalid token response');
		});

		it('rejects empty token strings and does not expose private response data in errors', () => {
			const emptyAccess = responseFor(' ');
			expect(() => createTokensFromResponse(emptyAccess)).toThrow('Invalid token response');

			const privateCanary = 'private-response-canary';
			const invalidJwt = responseFor(privateCanary);
			let errorMessage = '';
			try {
				createTokensFromResponse(invalidJwt);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				errorMessage = (error as Error).message;
			}
			expect(errorMessage).toBe('Invalid JWT');
			expect(errorMessage).not.toContain(privateCanary);

			expect(() =>
				createTokensFromResponse({
					access_token: jwt(claimsWithAccount('workspace-123')),
					refresh_token: '',
				})
			).toThrow('Invalid token response');
		});
	});

	describe('expiry utilities', () => {
		it('checks valid expiry and honors the refresh buffer', () => {
			expect(isTokenExpired(tokensWithExpiry(nowSeconds + 3600))).toBe(false);
			expect(isTokenExpired(tokensWithExpiry(nowSeconds + 200))).toBe(true);
			expect(isTokenExpired(tokensWithExpiry(nowSeconds + 200), 60)).toBe(false);
		});

		it.each([Number.NaN, Number.POSITIVE_INFINITY, '1700003600'])(
			'treats malformed expiry %s as expired',
			(expiresAt) => {
				const tokens = { ...tokensWithExpiry(futureExpiry), expiresAt } as unknown as OAuthTokens;
				expect(isTokenExpired(tokens)).toBe(true);
				expect(getTokenRemainingTime(tokens)).toBe(0);
			}
		);

		it('preserves remaining-time formatting', () => {
			expect(getTokenRemainingTime(tokensWithExpiry(nowSeconds + 9000))).toBe(9000);
			expect(formatTokenExpiry(tokensWithExpiry(nowSeconds + 9000))).toBe('2h 30m remaining');
			expect(formatTokenExpiry(tokensWithExpiry(nowSeconds + 1800))).toBe('30m remaining');
			expect(formatTokenExpiry(tokensWithExpiry(nowSeconds - 1))).toBe('Expired');
		});
	});
});
