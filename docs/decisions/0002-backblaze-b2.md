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
- **Incident.** One day uploads from the admin panel started failing in production with a mix of 401 and 500 errors. My first suspicion was the login: a 401 usually means an expired session, and the frontend even tried to refresh it on its own. The Render logs told a different story. The 401 came from Backblaze itself, which was rejecting the application key when the API tried to authorize. The fix was a new key in Render. But I also learned that a third-party error can't reach the client looking like *our* auth error, so now storage failures come back as a 502 and the frontend no longer confuses them with an expired session.
