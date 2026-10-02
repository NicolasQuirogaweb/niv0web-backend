# 0001 — Tokens in httpOnly cookies, not localStorage

**Status:** accepted · **Date:** 2026-08

## Context

The first version returned the JWT in the login response. The frontend kept it in `localStorage` and sent it as `Authorization: Bearer`, and it also stored the user's role there. That means any script running on the page (an XSS, a compromised dependency) can read the token and act as the user. Worse, the UI read the role from something the user could edit.

## Decision

The API sets two `httpOnly; Secure; SameSite=None` cookies: `accessToken` (15 min) and `refreshToken` (7 days, scoped to `/api/auth`). The frontend sends requests with `withCredentials` and never sees a token. The role comes from `GET /verify-token`, and admin routes check it again in the database.

The migration was dual-mode for a while: the backend accepted both the cookie and the header while the frontend switched over. The access token is no longer returned in the response body.

## Consequences

- JavaScript can't read the tokens, so an XSS can't steal them.
- `SameSite=None` is needed because front and API are on different sites. Protection against cross-site requests then comes from the CORS allowlist, and it has to stay strict.
- The `Authorization: Bearer` header is still accepted so the API can be tested with curl or Postman.
- Refresh tokens rotate and are revoked on logout through `tokenVersion` on the user.
