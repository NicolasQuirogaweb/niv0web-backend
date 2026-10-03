# 0004 — Direct downloads from B2, and MP3 previews for WAVs

**Status:** accepted · **Date:** 2026-10

## Context

Two complaints from using the site on a phone:

1. **Downloading a beat felt broken.** The frontend fetched the whole file through `/api/download` into memory and only then handed it to the browser. For a 45 MB WAV that's 10+ seconds with no feedback at all, and every extra tap started another full download.
2. **Changing tracks was slow**, especially from the lock screen. 11 of the 90 beats are WAVs: each change had to start streaming a 45 MB file.

## Decision

- **Downloads:** `GET /api/download/link` returns a B2 download authorization for that single file (valid 5 minutes) with `b2ContentDisposition=attachment; filename="<title>.<ext>"`. The browser downloads straight from B2 with its own progress UI. The proxy stays as a fallback.
- **Beat WAVs are licensed, not free.** The public catalog exposes only the MP3 of a beat (for listening and for the free download); both download endpoints refuse a beat WAV with `403 LICENSE_REQUIRED`. The WAV is delivered with the license, outside the site for now. Sample packs are the opposite: free, in their original format, as a contribution to the community.
- **Playback:** WAVs over 5 MB in beat and loop catalogs get a 192 kbps MP3 preview (~4 MB, ~10x smaller). It's stored as a derived artifact (`AudioPreview`, keyed by the original URL), so the catalog models and admin forms didn't change. The player uses the preview; downloads always deliver the original.

## Consequences

- Downloads start instantly and no longer use Render's bandwidth or memory.
- Each link costs one B2 class C transaction (2,500 free per day), more than enough here.
- The B2 key needs the `shareFiles` capability.
- Uploading a WAV takes a few extra seconds (the conversion). If ffmpeg fails, the upload still succeeds and the player falls back to the WAV.
- Deleting a track doesn't delete its preview yet, same as the original files (known limitation).
