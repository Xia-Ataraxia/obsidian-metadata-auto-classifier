<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# src/domain/auth/ — OAuth and Token Management

## Purpose

Pure domain logic for token validation, expiry, and authentication constants. NO Obsidian imports. Device-flow networking and UI belong in `ui/auth/`; there is no local listener or local PKCE implementation.

## Key Files

| File                 | Purpose                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `token-manager.ts`   | Token validation, expiry checking, JWT claim parsing, token lifecycle utilities |
| `oauth-constants.ts` | Fixed Codex device authorization, token, and inference endpoints                |
| `index.ts`           | Barrel export of public auth APIs                                               |

## For AI Agents

- All functions are pure and deterministic
- Token validation happens before API requests in `ui/` layer
- Never restore a loopback server, Node HTTP fallback, or local PKCE flow
- JWT parsing validates shape and expiry; it does not verify signatures or establish permission
- Route with `chatgpt_account_id`, never a user identifier or `sub`
- Unit tests require minimal setup (no mocks for pure functions)

## Dependencies

- Imports from: `types/` (auth types) only
- Do NOT import from: `obsidian`, `ui/`, or other domain modules
- Exports to: `ui/auth/`, `main.ts`
