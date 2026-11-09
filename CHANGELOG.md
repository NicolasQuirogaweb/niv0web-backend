# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts with the September 2026 cleanup; earlier history is in `git log`.

## [Unreleased]

### Added
- Sample packs get an optional English description, `descriptionEn` (max 300 characters). The admin create and update endpoints accept it, and `""` clears it. The public pack responses return it, or `null` when it is missing, in which case the English site falls back to `description`.
- Sample packs with folders and ZIP downloads: ordered `folders` per pack, `folder` per sample, `slug`, optional prices, publish rules (empty or paid packs can't be published), `GET /api/resources/samplepacks/:slug`, admin folder endpoints and `POST /api/admin/samplepacks/:id/zip` (streamed ZIP build with atomic claim and stale tracking). See ADR 0005.
- `scripts/migrate-samplepacks.js` (`npm run migrate:samplepacks`): merges the old packs into Mastermind; dry run by default, idempotent `--apply`, `--delete-old` for empty packs.
- `GET /api/discography`: the artist's own Spotify releases for the About page, cached in Mongo. `POST /api/jobs/refresh-discography` refreshes it with a jobs token; a Spotify failure keeps the old cache.
- `GET /api/download/link`: signed, single-file B2 link that downloads as an attachment named after the track, so the browser downloads directly from B2 with its own progress bar.
- MP3 previews (192 kbps) for WAVs over 5 MB in beat and loop catalogs (sample packs stay untouched), exposed as `previewFile` in the public catalog. `scripts/backfill-previews.js` for existing files.
- Beat WAVs are no longer handed out for free: the public catalog exposes their MP3 and the download endpoints answer `403 LICENSE_REQUIRED` for a beat WAV. Free sample packs stay free, downloaded as their ZIP.
- `keep-warm` workflow that pings `/health` every 10 minutes so Render's free plan doesn't sleep.

### Changed
- No beat file is downloadable for free any more, not even the MP3 or its preview: `/api/download/link` and `/api/download` answer `403 LICENSE_REQUIRED`. Beats will be sold with a license. Loops are unchanged.
- Single-sample downloads are refused too (`samples/` keys, `403 LICENSE_REQUIRED`): a pack is downloaded only as its ZIP. Loops are unchanged; listening is unaffected (public B2 URLs).
- `GET /api/resources/samples` and `/api/resources/samples/playlist/:id` are gone (`404`, like any unknown type, which used to be `400`): they returned samples of any pack and the raw pack, ZIP key included, without checking `published`. `/samplepacks` and `/samplepacks/:slug` are the public API.
- **Breaking for the frontend:** public route `/samplePacks` → `/samplepacks`, counts renamed to `itemsCount`, `/dashboard` adds `beatPlaylists`/`loopPlaylists`, login and refresh no longer return `token` in the body.
- Node 22, Docker image runs as non-root with a healthcheck.

### Fixed
- Users got logged out after reloading about 20 pages in 15 minutes: the strict auth limit (20 per 15 min per IP) also counted the session check that runs on every page load, and then blocked logging in again. It now applies only to `POST /api/auth/google-login`; `verify-token` and `refresh` stay under the general limit.
- Google login failed with `400 VALIDATION_ERROR` for accounts where Google sends no profile photo (`picture`): `imageUrl` was required. It is optional now (`null` when there is none), an existing user keeps the photo we had, and a missing name falls back to the start of the email.
- A pack without a cover (like Mastermind) could not be saved from the admin: `imageUrl` `""` or `null` is accepted and stored as `null`, which also removes a cover.
- Renaming a sample now marks the pack ZIP stale (the title is its file name inside the ZIP).
- Loop catalogs always showed 0 items in the public list.
- Beats could be created in loop catalogs (and vice versa) or in catalogs that don't exist.
- PUT routes skipped validation.
- `Samples.samplepackId` referenced a model that doesn't exist.

### Security
- Google login verifies the ID token's audience against `GOOGLE_CLIENT_ID`.
- `/api/download` only proxies URLs from our B2 bucket.
- Refresh tokens rotate on every refresh and are revoked on logout.
- `trust proxy` enabled so rate limits apply per client.
- JSON body limit lowered from 50 MB to 1 MB. Uploads are capped at 100 MB × 10 files.

### Removed
- Unused `protectedRoutes`, `authenticateJWT`, mailer and `nodemailer`.
- Local audio folders from git tracking.
