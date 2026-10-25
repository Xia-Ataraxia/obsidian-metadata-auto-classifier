import {
	parseJwtClaims,
	extractAccountId,
	isTokenExpired,
	createTokensFromResponse,
	getTokenRemainingTime,
	formatTokenExpiry,
} from '../../../src/domain/auth/token-manager';
import type { OAuthTokens, TokenResponse } from '../../../src/types/auth';

describe('token-manager', () => {
	// Mock Date.now for consistent testing
	const mockNow = 1700000000000; // Fixed timestamp

	beforeEach(() => {
		vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('parseJwtClaims', () => {
		it('should parse valid JWT and extract claims', () => {
			// JWT with payload: {"sub": "user123", "name": "Test User"}
			const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
			const payload = btoa(JSON.stringify({ sub: 'user123', name: 'Test User' }));
			const signature = 'fake-signature';
			const token = `${header}.${payload}.${signature}`;

			const claims = parseJwtClaims(token);

			expect(claims.sub).toBe('user123');
			expect(claims.name).toBe('Test User');
		});

		it('should handle base64url encoded payloads', () => {
			// Base64url uses - and _ instead of + and /
			const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
			const payload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0';
			const signature = 'fake';
			const token = `${header}.${payload}.${signature}`;

			const claims = parseJwtClaims(token);

			expect(claims.sub).toBe('1234567890');
			expect(claims.name).toBe('John Doe');
		});

		it('should throw error for invalid JWT format (not 3 parts)', () => {
			expect(() => parseJwtClaims('invalid-token')).toThrow('Invalid JWT format');
			expect(() => parseJwtClaims('only.two')).toThrow('Invalid JWT format');
			expect(() => parseJwtClaims('a.b.c.d')).toThrow('Invalid JWT format');
		});

		it('should throw error for invalid base64 payload', () => {
			const token = 'header.!!!invalid-base64!!!.signature';
			expect(() => parseJwtClaims(token)).toThrow('Failed to decode JWT payload');
		});

		it('should throw error for non-JSON payload', () => {
			const header = btoa('header');
			const payload = btoa('not-json');
			const token = `${header}.${payload}.signature`;
			expect(() => parseJwtClaims(token)).toThrow('Failed to decode JWT payload');
		});
	});

	describe('extractAccountId', () => {
		it('should extract user_id from OpenAI auth claims', () => {
			const claims = {
				'https://api.openai.com/auth': {
					user_id: 'openai-user-123',
				},
			};
			const header = btoa(JSON.stringify({ alg: 'HS256' }));
			const payload = btoa(JSON.stringify(claims));
			const token = `${header}.${payload}.sig`;

			const accountId = extractAccountId(token);

			expect(accountId).toBe('openai-user-123');
		});

		it('should fall back to sub claim if OpenAI auth claims not present', () => {
			const claims = { sub: 'fallback-user-456' };
			const header = btoa(JSON.stringify({ alg: 'HS256' }));
			const payload = btoa(JSON.stringify(claims));
			const token = `${header}.${payload}.sig`;

			const accountId = extractAccountId(token);

			expect(accountId).toBe('fallback-user-456');
		});

		it('should throw error if no account ID can be extracted', () => {
			const claims = { name: 'No user ID here' };
			const header = btoa(JSON.stringify({ alg: 'HS256' }));
			const payload = btoa(JSON.stringify(claims));
			const token = `${header}.${payload}.sig`;

			expect(() => extractAccountId(token)).toThrow('Could not extract account ID from token');
		});
	});

	describe('isTokenExpired', () => {
		it('should return false for non-expired token', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 + 3600, // Expires in 1 hour
				accountId: 'user123',
			};

			expect(isTokenExpired(tokens)).toBe(false);
		});

		it('should return true for expired token', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 - 100, // Expired 100 seconds ago
				accountId: 'user123',
			};

			expect(isTokenExpired(tokens)).toBe(true);
		});

		it('should return true when within default buffer (5 minutes)', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 + 200, // Expires in ~3.3 minutes (within 5 min buffer)
				accountId: 'user123',
			};

			expect(isTokenExpired(tokens)).toBe(true);
		});

		it('should use custom buffer when provided', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 + 200, // Expires in ~3.3 minutes
				accountId: 'user123',
			};

			// With 60 second buffer, should not be considered expired
			expect(isTokenExpired(tokens, 60)).toBe(false);
			// With 300 second buffer (5 min), should be considered expired
			expect(isTokenExpired(tokens, 300)).toBe(true);
		});
	});

	describe('createTokensFromResponse', () => {
		it('should create OAuthTokens from token response', () => {
			// Create a mock token with extractable account ID
			const claims = { sub: 'test-user-id' };
			const header = btoa(JSON.stringify({ alg: 'HS256' }));
			const payload = btoa(JSON.stringify(claims));
			const mockAccessToken = `${header}.${payload}.sig`;

			const response: TokenResponse = {
				access_token: mockAccessToken,
				refresh_token: 'refresh-token-123',
				expires_in: 3600,
				token_type: 'Bearer',
			};

			const tokens = createTokensFromResponse(response);

			expect(tokens.accessToken).toBe(mockAccessToken);
			expect(tokens.refreshToken).toBe('refresh-token-123');
			expect(tokens.accountId).toBe('test-user-id');
			// expiresAt should be current time + expires_in
			expect(tokens.expiresAt).toBe(Math.floor(mockNow / 1000) + 3600);
		});
	});

	describe('getTokenRemainingTime', () => {
		it('should return remaining seconds until expiry', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 + 3600, // Expires in 1 hour
				accountId: 'user123',
			};

			const remaining = getTokenRemainingTime(tokens);

			expect(remaining).toBe(3600);
		});

		it('should return 0 for expired tokens', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 - 100, // Expired
				accountId: 'user123',
			};

			const remaining = getTokenRemainingTime(tokens);

			expect(remaining).toBe(0);
		});
	});

	describe('formatTokenExpiry', () => {
		it('should format remaining time with hours and minutes', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 + 7200 + 1800, // 2h 30m remaining
				accountId: 'user123',
			};

			const formatted = formatTokenExpiry(tokens);

			expect(formatted).toBe('2h 30m remaining');
		});

		it('should format remaining time with only minutes when less than an hour', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 + 1800, // 30m remaining
				accountId: 'user123',
			};

			const formatted = formatTokenExpiry(tokens);

			expect(formatted).toBe('30m remaining');
		});

		it('should return "Expired" for expired tokens', () => {
			const tokens: OAuthTokens = {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAt: mockNow / 1000 - 100, // Expired
				accountId: 'user123',
			};

			const formatted = formatTokenExpiry(tokens);

			expect(formatted).toBe('Expired');
		});
	});
});
