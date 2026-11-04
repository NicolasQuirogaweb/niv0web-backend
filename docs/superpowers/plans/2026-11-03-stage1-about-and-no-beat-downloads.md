# Stage 1 — About me, Spotify discography, no free beat downloads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public About me page with Nicolás's story and his Spotify releases in a vinyl grid, and no beat downloadable for free anywhere on the site.

**Architecture:** The backend gets a small Spotify client (Client Credentials). It caches the artist's albums and singles in Mongo, exposes them at a public `GET /api/discography`, and refreshes them through a token-protected job endpoint that a GitHub Actions cron calls every 6 h. The download endpoints refuse every beat file (`beats/` and `previews/`), not only WAVs. The frontend adds a public `/about` route with a vinyl grid that embeds Spotify's album player, and hides the download button in beat catalogs.

**Tech Stack:**
- Backend (`niv0web-backend`): Node 22, Express 4, Mongoose 8, Jest + supertest, global `fetch` (Node 22). No Spotify SDK.
- Frontend (`niv0web-frontend`): React 18 + Vite, React Router 6, i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-03-store-and-about-design.md` (backend repo).

**Scope:** this plan covers **Stage 1 only**. Stages 2 (Mercado Pago end to end) and 3 (PayPal) each get their own plan when their accounts exist (domain, Resend, Mercado Pago, PayPal). They are sketched at the end, without tasks.

## Global Constraints
- **About me and discography are public:** no login, no `PrivateRoute`.
- **Discography:** only the artist's own releases. Spotify `include_groups=album,single`, never `appears_on` or `compilation`.
- **Playback:** with Spotify's embed `https://open.spotify.com/embed/album/{id}`, so plays count on Spotify. Never with our own player.
- **No beat is downloadable for free:** neither the original nor the MP3 preview. Sample packs (and loops) stay downloadable.
- **Spotify not configured** (missing `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_ARTIST_ID`): the API must still boot, and `/api/discography` returns `[]`.
- **Text:** every visible string is an i18n key in both `es.json` and `en.json` (same keys). User-facing API messages are in Spanish.
- **Docs and process:** each repo follows its own `CLAUDE.md`. Every task updates README / CHANGELOG / `CLAUDE.md` where it changes behaviour. Conventional commits with a why-body and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer. Backend PR first, frontend PR second.

## Review Focus
1. **Spotify down or rate-limited during a refresh** → the last cached albums keep being served, and the job answers 502 without wiping the cache. *(Task 1 test.)*
2. **An album without images** → the vinyl card shows a neutral placeholder, not a broken image. *(Task 5 test.)*
3. **Keyboard and touch users** → every vinyl is a real button that opens the player with Enter or a tap (no hover-only behaviour), and Esc closes it. *(Task 5 test.)*
4. **A beat MP3 link already shared before this change** → `/api/download/link` and `/api/download` refuse it with `403 LICENSE_REQUIRED`. Sample packs still work. *(Task 3 test.)*
5. **Empty discography** (Spotify not configured or no releases) → About shows the story and hides the discography section instead of an empty grid. *(Task 5 test.)*

---

## Backend (`niv0web-backend`)

### Task 1: Spotify discography cache and public endpoint

**Files:**
- Create: `services/spotifyService.js`, `models/SpotifyAlbum.js`, `routes/discographyRoutes.js`, `tests/discography.test.js`
- Modify: `config/env.js` (3 optional vars + `JOBS_TOKEN`), `app.js` (mount `/api/discography` and `/api/jobs`), `.env.example`

**Interfaces:**
- Produces:
  - `GET /api/discography` → `{ success, data: Album[] }`, where `Album = { spotifyId, name, type: 'album'|'single', releaseDate: 'YYYY[-MM[-DD]]', imageUrl: string|null, spotifyUrl, totalTracks }`, sorted by `releaseDate` descending.
  - `POST /api/jobs/refresh-discography` with header `Authorization: Bearer <JOBS_TOKEN>` → `{ success, data: { count } }`.
  - `spotifyService.fetchArtistReleases(): Promise<Album[]>`.
  - `spotifyService.refreshDiscography(): Promise<number>`.

- [ ] **Step 1: Write the failing tests** in `tests/discography.test.js` (`global.fetch` mocked with `jest.spyOn`; `SpotifyAlbum` mocked like `AudioPreview` in `tests/downloads.test.js`):
  - `GET /api/discography` returns the cached albums sorted newest first.
  - `fetchArtistReleases` calls `https://accounts.spotify.com/api/token` with `grant_type=client_credentials` and Basic auth, then `https://api.spotify.com/v1/artists/<id>/albums?include_groups=album,single&limit=50`, and maps `album_type → type`, `images[0].url → imageUrl` (`null` when there are no images) and `external_urls.spotify → spotifyUrl`.
  - Job without token → 401. Wrong token → 401. Correct token → 200 with `{ count }`, and replaces the cache (`deleteMany` + `insertMany`).
  - Spotify answers 500 during the job → 502 `SPOTIFY_UNAVAILABLE`, and `deleteMany` is **not** called (Review Focus 1).
  - Spotify env vars missing → `GET /api/discography` returns `[]` and the job returns `{ count: 0 }` without calling `fetch`.
- [ ] **Step 2: Run** `npx jest tests/discography.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - `env.js`: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `SPOTIFY_ARTIST_ID` as `z.string().optional()`; `JOBS_TOKEN` as `z.string().min(32).optional()`. The job route answers 503 `JOBS_DISABLED` when `JOBS_TOKEN` is unset.
  - `SpotifyAlbum` schema mirrors `Album`, with `spotifyId` unique.
  - `refreshDiscography`: fetch first, and only on success replace the collection, so a failure never wipes the cache.
  - Follow pagination via `next` until it is null.
  - Use `ApiError` and `success()`; compare the job token with `crypto.timingSafeEqual`.
  - Lazy refresh: if the newest `updatedAt` is older than 6 h, `GET` triggers a background refresh (not awaited, errors logged) and still answers with the cache.
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: all pass.
- [ ] **Step 5: Docs.**
  - README API table: both endpoints and the env vars.
  - `docs/architecture.md`: a short "Discography" section.
  - `.env.example`: the new vars.
  - CHANGELOG (Added).
- [ ] **Step 6: Commit** `feat: Spotify discography cache with a public endpoint and a refresh job`.

### Task 2: Cron that refreshes the discography

**Files:**
- Create: `.github/workflows/refresh-discography.yml`

**Interfaces:**
- Consumes: `POST /api/jobs/refresh-discography` from Task 1.

- [ ] **Step 1: Write the workflow.**
  - Triggers: `schedule: "0 */6 * * *"` and `workflow_dispatch`.
  - Request: `curl -fsS --retry 3 --retry-delay 20 --max-time 120 -X POST -H "Authorization: Bearer ${{ secrets.JOBS_TOKEN }}" https://niv0web-api.onrender.com/api/jobs/refresh-discography`.
  - Comment at the top explaining why: Render Free sleeps, so a cron outside the server drives the job.
- [ ] **Step 2: Verify** that `npx js-yaml .github/workflows/refresh-discography.yml` parses (or that `gh workflow view` lists it after the push).
- [ ] **Step 3: Docs.** README "Known limitations": point to this workflow next to `keep-warm`, and note the repo secret `JOBS_TOKEN`.
- [ ] **Step 4: Commit** `ci: refresh the Spotify discography every 6 hours`.

### Task 3: Refuse every beat file on the download endpoints

**Files:**
- Modify: `utils/downloadSource.js` (`isLicensedOriginal`), `tests/downloads.test.js`, `docs/decisions/0004-direct-downloads-from-b2.md`, `CLAUDE.md`, README

**Interfaces:**
- Produces: `isLicensedOriginal(key: string): boolean` → true for any key under `beats/` and any key under `previews/`. The name is kept so `app.js` doesn't change.

- [ ] **Step 1: Update the tests.** In `tests/downloads.test.js`:
  - `isLicensedOriginal('beats/a.mp3')` → true.
  - `isLicensedOriginal('previews/a.mp3')` → true.
  - `isLicensedOriginal('samples/a.wav')` → false.
  - `isLicensedOriginal('loops/a.wav')` → false.
  - The existing "returns a signed link…" test now uses a **sample** URL. A new test: a beat **MP3** URL gets `403 LICENSE_REQUIRED` on both `/api/download/link` and `/api/download` (Review Focus 4).
- [ ] **Step 2: Run** `npx jest tests/downloads.test.js`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the new rule in `isLicensedOriginal`: `/^(beats|previews)\//i`. Update its comment: beats are sold with a license (spec, goal 1).
- [ ] **Step 4: Run** `npm run lint && npm test`. Expected: all pass.
- [ ] **Step 5: Docs.**
  - ADR 0004: add "Update 2026-11: no beat file is downloadable for free".
  - `CLAUDE.md` security rule wording.
  - README endpoint description.
  - CHANGELOG (Changed).
- [ ] **Step 6: Commit** `feat: no beat file is downloadable for free`, then open the backend PR.

## Frontend (`niv0web-frontend`)

### Task 4: Hide downloads in beat catalogs

**Files:**
- Modify: `src/components/common/TrackList.jsx` (new prop), `src/components/Playlist.jsx`, `src/i18n/es.json`, `src/i18n/en.json`, `src/components/common/TrackList.test.jsx`, `src/components/Playlist.test.jsx`

**Interfaces:**
- Produces: `<TrackList allowDownload={boolean} … />`. The default is `true`, so sample packs don't change.

- [ ] **Step 1: Write the failing tests.**
  - `TrackList` with `allowDownload={false}` renders no button whose name matches `playlist.download`.
  - `Playlist.test.jsx`: a beats catalog shows no download button and shows the text `playlist.beatsLicenseNote`. A loops catalog still shows download buttons.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `Playlist.jsx` passes `allowDownload={resourceType !== "beats"}`.
  - Replace the `playlist.mp3Note` paragraph with `playlist.beatsLicenseNote`. Remove the `mp3Note` key from both files.
  - Copy:
    - es: `"Los beats se compran con licencia (común, exclusiva o exclusiva + stems). Muy pronto vas a poder comprarlos acá; mientras tanto, escribime."`
    - en: `"Beats are sold with a license (common, exclusive or exclusive + stems). You'll soon be able to buy them here; until then, message me."`
- [ ] **Step 4: Run** `npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 5: Docs.** README "Downloads": beats are not downloadable. CHANGELOG (Changed). `CLAUDE.md`: `allowDownload` is false for beats.
- [ ] **Step 6: Commit** `feat: beat catalogs are listen-only`.

### Task 5: Public About me page with the vinyl discography

**Files:**
- Create:
  - `src/components/About.jsx`, `src/components/About.css`, `src/components/About.test.jsx`
  - `src/components/common/VinylGrid.jsx`, `src/components/common/VinylGrid.test.jsx`
  - `src/content/about.js`: `export const ABOUT_PHOTO_URL` (B2 URL that Nicolás provides; `null` until then)
- Modify:
  - `src/services/api.js`: `discographyService.getAll()` → `GET /api/discography`
  - `src/routes/MyRoutes.jsx`: `/about`, lazy, **no** `PrivateRoute`
  - `src/i18n/es.json`, `src/i18n/en.json`: section `about` with `seoTitle`, `seoDesc`, `title`, `story` (an array of paragraphs; placeholder written by Nicolás later), `discography`, `listenOnSpotify`, `close`, `noCover`

**Interfaces:**
- Consumes: `GET /api/discography` → `Album[]` (Task 1).
- Produces: `<VinylGrid albums={Album[]} />`, a self-contained component that owns the "open album" state.

- [ ] **Step 1: Write the failing tests.**
  - `VinylGrid`: each album renders a `button` named after the album, with its year.
  - Clicking or pressing Enter on it renders an `iframe` with `src` `https://open.spotify.com/embed/album/<spotifyId>` and a title containing the album name.
  - Esc and the close button remove the iframe (Review Focus 3).
  - An album with `imageUrl: null` renders the `about.noCover` placeholder (Review Focus 2).
  - Only one album is open at a time.
  - `About`: renders the title and the story paragraphs **without** `AuthProvider` or a logged-in user. With `discographyService.getAll` resolving `[]`, the discography heading is absent (Review Focus 5). With albums, it renders the grid.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **About:** `SEO`, a simple public header (logo link to `/home` + `LanguageSwitcher`; **not** `PageHeader`, which needs a session), photo (if `ABOUT_PHOTO_URL`), story paragraphs from `t("about.story", { returnObjects: true })`, then `VinylGrid` if `albums.length > 0`.
  - **VinylGrid:** CSS grid of square sleeves, with a vinyl disc behind each sleeve. Hover or focus slides the disc out about 35% and spins it. The open album expands to show the embed (`height="352"`, `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"`, `loading="lazy"`). Respect `prefers-reduced-motion` (no spin). Use the site palette from `Playlist.css` (`#bbf0be` accent on dark).
- [ ] **Step 4: Run** `npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: public About me page with a vinyl discography from Spotify`.

### Task 6: Navigation, SEO and docs for About

**Files:**
- Modify:
  - `src/components/Home.jsx` and `src/components/HomeLogued.jsx`: an `about` link with class `about-home`, styled like the other home links in `Home.css` / `HomeLogued.css`
  - `public/robots.txt`: no change (`/about` must stay indexable)
  - README, `README.es.md`, CHANGELOG, `CLAUDE.md`

- [ ] **Step 1: Write the failing test.** `Home` renders a link to `/about` named `home.about` (new key, es `"ABOUT"` / en `"ABOUT"`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the links and the keys.
- [ ] **Step 4: Run** `npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 5: Docs.**
  - README "Pages" table: `/about`, public.
  - README "Player": albums use Spotify's embed so plays count there.
  - `README.es.md`: one paragraph.
  - CHANGELOG (Added).
  - `CLAUDE.md`: About is public and must not use `PageHeader` or session hooks.
- [ ] **Step 6: Commit** `feat: link About from both homes`, then open the frontend PR.

## Release (manual, with Nicolás)
1. **Nicolás:**
   - Creates the Spotify app.
   - Sets in Render: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_ARTIST_ID`, `JOBS_TOKEN` (`openssl rand -hex 32`).
   - Sets the repo secret `JOBS_TOKEN` in GitHub.
2. Merge the backend PR. Run `gh workflow run refresh-discography.yml`, then check that `GET /api/discography` lists his releases.
3. Local test of the frontend branch: About on desktop and mobile view, a beat catalog without downloads, a sample pack with downloads.
4. Merge the frontend PR. Verify production: `/about` without login, the embed plays, no download button on beats, and a beat MP3 link gets 403.
5. Nicolás replaces the placeholder story and the photo. That's a small PR with the text only.

---

## Stage 2 sketch: Mercado Pago end to end (own plan later)
Needs: domain, Resend, Mercado Pago credentials, license texts, WAVs.
- Private bucket `niv0-private`. Migrate the 11 WAVs (copy → verify → delete public originals, after explicit OK).
- Admin direct-to-B2 uploads for WAV and stems.
- Models: `Order` (user, beat, license, provider, status `pending|paid|expired|refund_needed`, amount, currency, providerIds), `Settings` (prices ARS/USD). On `Beat`: `wavKey`, `stemsKey`, `status: 'available'|'reserved'|'sold'`, `reservedUntil`.
- Checkout:
  - `POST /api/orders` reserves exclusives atomically for 30 min.
  - Mercado Pago preference; exclusives exclude `ticket` and `atm`.
- Payment confirmation:
  - The webhook verifies the payment against the MP API, marks the order paid and the beat sold.
  - Resend mail to the buyer and to Nicolás.
  - A reconciliation job behind the same token + cron pattern as Task 2.
- Buyer side:
  - "Mis compras" page with signed links to the private files.
  - "Comprar" modal with the license choice and the terms checkbox.
  - "Consultar" for beats without a WAV, and a "Vendido" badge.
- Tests with MP mocked, plus a sandbox end-to-end run before production.

## Stage 3 sketch: PayPal (own plan later)
- PayPal Orders v2: create, approve and capture, plus a webhook, all on the same `Order` model with `currency: 'USD'` and USD prices from `Settings`.
- The modal offers PayPal next to Mercado Pago.
- Sandbox end-to-end run before production.
