# 0002 — Files in Backblaze B2, not on the server

**Status:** accepted

## Context

At first the audio lived in folders inside the repo (`beats/`, `samples/`...) and Express served it as static files. That has three problems. The repo grew past 1 GB. Render's filesystem is ephemeral, so anything uploaded from the admin panel was lost on the next deploy. And every play went through the API.

## Decision

Everything goes to a public Backblaze B2 bucket. The API uploads through `services/b2Service.js` and stores the resulting URL, and the browser plays straight from B2.

I picked B2 over S3 for cost: for a personal catalog that's mostly read, storage and egress are cheaper, and the API is simple.

## Consequences

- The API is stateless and can be redeployed without losing anything.
- Forcing a download needs a proxy (`/api/download`), because browsers ignore `download` on cross-origin links. That proxy has to be locked to our bucket (see [architecture](../architecture.md#download-proxy)).
- Deleting a catalog doesn't delete its files in B2 yet. That's a known limitation.
- **Incident:** uploads started failing with 401/500 in production. The cause wasn't the users' sessions: B2 was rejecting the application key in `b2_authorize_account`. Two changes came out of that. B2 errors are normalized to a 502, so the frontend doesn't mistake them for an expired session and try to refresh. And a B2 401/403 now forces a new authorization before retrying.

<!-- ✍️ NICO: tell the incident in 2-3 lines in your own words: how you found out, what you thought it was
     at first, what it turned out to be. That anecdote is worth more than the whole ADR. -->
