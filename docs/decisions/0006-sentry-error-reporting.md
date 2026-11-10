# 0006. Sentry for production errors

Date: 2026-11-09. Status: accepted.

## Context

Until now a production error was only visible in Render's logs, which the free plan keeps for a short time, and only if someone went looking. Nicolás found bugs (like the login that failed for one email) by trying the site himself.

## Decision

Use Sentry (free plan, organization `nquirogawebdev`, project `niv0-backend`) through `@sentry/node`:

- `services/monitoring.js` starts it from `server.js` only when `SENTRY_DSN` is set. Local runs and tests send nothing.
- `middleware/errorHandler.js` reports only status 500 errors. Validation, auth and not-found errors (4xx) are expected and stay out.
- `sendDefaultPii: false` and `tracesSampleRate: 0`: no IPs, cookies or headers, and no performance traces, only errors. That keeps us inside the free quota.

The frontend has its own project, `niv0-frontend` (see the frontend's ADR 0013).

## Consequences

- Errors arrive with their stack trace and can be read from Claude Code through the Sentry MCP.
- `SENTRY_DSN` is set in Render. A DSN only lets you send events, not read them, so it is not a secret, but it still lives in the environment, not in the code.
