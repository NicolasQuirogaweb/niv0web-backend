# 0003 — Docker on Render

**Status:** accepted

## Context

Render can run a Node app directly: it detects `package.json` and chooses the Node version and install command itself. That works until your local Node and Render's disagree, or a build flag changes.

## Decision

Render builds the image from the repo's `Dockerfile`:

- `node:22-alpine`, the same major version as `.nvmrc` and CI.
- `npm ci --omit=dev`: the exact dependencies from the lockfile, without dev tools.
- `NODE_ENV=production`, so stack traces and the 500 detail stay out of responses.
- It runs as the `node` user, not root.
- `HEALTHCHECK` against `/health`.

`.dockerignore` keeps `.env`, tests, docs and local media out of the image. The env vars are set in Render's dashboard.

## Consequences

- The same image runs locally (`docker run --env-file .env`), in CI (`docker build` on every push) and in production.
- Moving to another host (Fly, Railway, a VPS) doesn't need any reconfiguration.
- Builds are a bit slower than native Node on Render. It doesn't matter at this size.
