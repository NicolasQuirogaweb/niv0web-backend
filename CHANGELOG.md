# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts with the September 2026 cleanup; earlier history is in `git log`.

## [Unreleased]

### Security
- Google login verifies the ID token's audience against `GOOGLE_CLIENT_ID`.
- `/api/download` only proxies URLs from our B2 bucket.
- Refresh tokens rotate on every refresh and are revoked on logout.
- `trust proxy` enabled so rate limits apply per client.
- JSON body limit lowered from 50 MB to 1 MB. Uploads are capped at 100 MB × 10 files.

### Fixed
- Loop catalogs always showed 0 items in the public list.
- Beats could be created in loop catalogs (and vice versa) or in catalogs that don't exist.
- PUT routes skipped validation.
- `Samples.samplepackId` referenced a model that doesn't exist.

### Changed
- **Breaking for the frontend:** public route `/samplePacks` → `/samplepacks`, counts renamed to `itemsCount`, `/dashboard` adds `beatPlaylists`/`loopPlaylists`, login and refresh no longer return `token` in the body.
- Node 22, Docker image runs as non-root with a healthcheck.

### Removed
- Unused `protectedRoutes`, `authenticateJWT`, mailer and `nodemailer`.
- Local audio folders from git tracking.
