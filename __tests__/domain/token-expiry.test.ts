import { formatTokenExpiry } from '../../src/domain/auth/token-manager';

const tokens = (expiresAt: number) => ({ accessToken: 'a', refreshToken: 'r', expiresAt, accountId: 'x' });
const nowSec = () => Math.floor(Date.now() / 1000);

describe('formatTokenExpiry', () => {
	it('treats expiresAt as epoch seconds', () => {
		expect(formatTokenExpiry(tokens(nowSec() + 2 * 3600 + 5 * 60 + 30))).toBe('2h 5m remaining');
		expect(formatTokenExpiry(tokens(nowSec() + 90))).toBe('1m remaining');
	});

	it('reports expired tokens', () => {
		expect(formatTokenExpiry(tokens(nowSec() - 10))).toBe('Expired');
	});
});
