# 0005 — Sample packs with folders and ZIP downloads

**Status:** accepted · **Date:** 2026-11

## Context

Sample packs were five separate packs (Drums, 808, Bass, Synths, Fxs), each a flat list of WAVs. Listeners could only grab files one by one, and the free-WAV rule meant every sample URL was handed out directly. The design is in `docs/superpowers/specs/2026-11-04-sample-packs-browser-design.md`.

## Decision

- **One pack, many folders.** A `SamplePack` has an ordered `folders` list and each `Samples` document has a `folder`. The five old packs become folders of one pack, **Mastermind** (`scripts/migrate-samplepacks.js`: dry run by default, `--apply` is idempotent and verifies the counts before publishing).
- **Published / paid rule.** A pack is free when `priceArs` is empty (`isFreePack`). It can be published only if it has samples and is free (`publishProblem`): a paid pack answers `PACK_PAID_NOT_SELLABLE` until the store exists. Only free packs expose their ZIP URL publicly.
- **Listening vs downloading.** Sample WAVs can be heard in the browser; the pack is downloaded as a single ZIP built on the server (`pack/folder/title.ext`).
- **ZIP build.** `services/zipService.js` streams every sample from B2 into `archiver` and straight into a B2 large-file upload, so nothing is held whole in memory: the ZIP is about 143 MB and Render Free has 512 MB of RAM. Each source download is cut after 60 s without bytes (idle timeout) and the whole build after 30 min.
- **Stale ZIPs.** Editing a pack (title, folders, samples) sets `zip.stale = true` and stamps `zip.staleAt`. The ZIP is rebuilt by hand from the admin panel, never automatically.

## Build concurrency

- `POST /api/admin/samplepacks/:id/zip` answers `202 { status: 'building' }` and builds in the background. It **claims** the build atomically with a `findOneAndUpdate` that sets `zip.build = { status: 'building', startedAt, error: null }` only if the pack is not already building. A second request gets `409 ZIP_BUILDING`; a pack with no samples gets `409 PACK_EMPTY`.
- A `building` state older than 30 min (`ZIP_BUILD_TIMEOUT_MS`) is treated as dead (the process was killed): `zipBuildStatus` reports it as `failed` and the endpoint may claim it again.
- `buildPackZip(id, deps, { startedAt })` only writes its result while `zip.build.startedAt` still equals its own claim. If it was superseded it deletes the file it uploaded and writes nothing.
- Admin edits stamp `zip.staleAt`. A build that started before an edit leaves `zip.stale: true`, so a ZIP is never reported as fresh when a sample changed mid-build.

## Consequences

- Downloading a pack is one request against B2 and costs the API nothing.
- A ZIP can be outdated until an admin rebuilds it; the admin panel shows `stale`.
- Builds are one at a time per pack, but different packs could build in parallel, a memory risk on Render Free (known limitation while only Mastermind exists).
- The old packs are unpublished, not deleted; `--delete-old` removes the empty ones, only with the owner's OK.
