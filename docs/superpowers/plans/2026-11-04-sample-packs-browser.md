# Sample Packs with an FL-style Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the five fake "sample packs" into one real pack, **Mastermind**, with folders. Show packs as a showcase, open each in an FL Studio-style browser, and serve the whole pack as a ZIP built by the backend.

**Architecture:**
- **Backend:** `SamplePack` gains `slug`, `folders`, prices, `published` and `zip`; `Samples` gains `folder` and `durationSec`.
- **ZIP build:** a background job streams the WAVs from B2 through `archiver` (store mode) into a B2 large-file upload, so the ZIP is never held whole in memory.
- **Migration:** a one-off script moves the 247 samples into Mastermind.
- **Frontend:** the `/samplepacks` showcase, a `/samplepacks/:slug` page with `SampleBrowser`, and admin screens for folders, prices, publishing and the ZIP.

**Tech Stack:**
- **Backend:** Express 4, Mongoose 8, backblaze-b2, archiver (new dependency), axios. Tests use Jest and supertest, with models mocked.
- **Frontend:** React 18, Vite, react-router, i18next. Tests use Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-04-sample-packs-browser-design.md`. The visual reference is `docs/superpowers/specs/2026-11-04-sample-packs-browser-mockup.html`.

**Repos:** B = `backend/api-niv0web`, F = `frontend/niv0-web`. Each branch starts from `main`:
- **B `feat/sample-packs`:** Tasks 1–6. It also carries the spec and this plan as its first commit.
- **F `feat/sample-pack-browser`:** Tasks 7–10.
- **B `feat/lock-sample-downloads`:** Task 11. It merges only after F is in production.

## Global Constraints
- **No new screens beyond the spec.** The admin keeps its two pages: the pack list and the samples page. The pack form is a dedicated component on the same routes.
- **Access:** catalogs and ZIP require login, as today (`PrivateRoute`).
- **Copy:** every user-facing string goes through i18n, in both ES and EN. The admin and API error messages are in Spanish.
- **Look:** amber accent tokens only. Bebas Neue (`--font-display`, one weight, never set bold; frontend ADR 0006) for headings, buttons and labels; Inter (`--font-body`) for reading text. `PageBackground` uses `PAGE_BACKGROUNDS.samplePacks`. Reduced motion is honoured.
- **Consistency with the rest of the site (decided 2026-11-05, after this plan was first written):**
  - The showcase reuses the frontend's `CatalogConsole` (frontend ADR 0010: spinning record whose label is the selected item's cover, 3D bars), not glass cards.
  - Every page uses `useConsoleNav({ back })` (frontend ADR 0008): the showcase goes back to `/homelogued`, a pack page back to `/samplepacks`. What can be picked carries `data-nav-item`.
- **Folder order for Mastermind:** `Drums, 808, Bass, Synths, Fxs`. The pack is named `Mastermind`, with slug `mastermind`.
- **Prices:** ARS is required for a paid pack and USD is optional. A pack is free when `priceArs` is `null`. **A pack with a price cannot be published.**
- **Visibility:** the public API and the showcase show only `published: true`. A new pack starts unpublished.
- **ZIP:**
  - built with `archiver` in store mode (no compression);
  - path inside is `<pack title>/<folder>/<sample title><ext>`;
  - stored in the public bucket at `samplepacks/<slug>-<base36 timestamp>.zip`, with `b2-cache-control: public, max-age=31536000, immutable`;
  - the previous ZIP file is deleted from B2 only after the new one is saved;
  - a build is treated as failed after **30 min**.
- **Stale ZIP:** the ZIP is marked stale when a sample is added, deleted, moved or has its audio replaced, and when the pack or a folder is renamed.
- **Downloads:** no single-sample download in the UI. After Task 11 there is none through `/api/download*` either.
- **Backend rules (`CLAUDE.md`):**
  - errors via `ApiError`, responses via `success()`;
  - express-validator plus `validate` on new bodies;
  - `countByParent` for counts;
  - never read `.env`.
- **Done means:** `npm run lint && npm test` pass in B, and `npm run lint && npm test && npm run build` pass in F.

## Review Focus
1. **Two samples with the same title in one folder.** ZIP entries must not collide. The second one becomes `name (2).wav`. Tested in Task 4.
2. **Sample or folder names with `/ \ : * ? " < > |` or control characters.** They are sanitised in ZIP paths, and folder names with `/` or `\` are rejected. Tested in Tasks 1 and 4.
3. **Render restarts mid-build, or the admin clicks "Armar ZIP" twice.**
   - A build older than 30 min reads as `failed` and can be retried.
   - A second request while one is building gets a 409 `ZIP_BUILDING`.
   - Tested in Tasks 1 and 5.
4. **A WAV is missing in B2 (404) during the build.**
   - The build fails, with an error naming the sample.
   - The large-file upload is cancelled.
   - The previous ZIP stays served and is not deleted.
   - Tested in Task 4.
5. **Two packs with the same title, or renaming a folder to an existing name.**
   - The slug becomes unique (`-2`).
   - A duplicate folder name is rejected with `FOLDER_EXISTS`, case-insensitive.
   - Deleting a non-empty folder gets `FOLDER_NOT_EMPTY`.
   - Tested in Tasks 1 and 3.

---

### Task 1 (B): Models and pack rules

**Files:**
- Modify: `models/SamplePack.js`, `models/Samples.js`
- Create: `utils/samplePacks.js`, `tests/samplePacks.test.js`

**Interfaces — Produces:**
- **`SamplePack` fields:**
  - `slug: String`, unique and sparse;
  - `folders: [String]`, default `[]`;
  - `priceArs: Number|null` and `priceUsd: Number|null`, `min: 0`, default `null`;
  - `published: Boolean`, default `false`;
  - `imageUrl`, now optional;
  - `zip`:
    - `url`, `key`, `fileId`: String|null;
    - `bytes`: Number|null;
    - `builtAt`: Date|null;
    - `stale`: Boolean, default `false`;
    - `build`: `{ status: 'idle'|'building'|'failed', default 'idle'; startedAt: Date|null; error: String|null }`.
- **`Samples` fields:** `folder: String`, required, max 50; `durationSec: Number|null`.
- **From `utils/samplePacks.js`:**
  - `slugify(title: string) => string`;
  - `uniqueSlug(title: string, exists: (slug) => Promise<boolean>) => Promise<string>`;
  - `cleanFolderName(name: unknown) => string`, which throws `ApiError.badRequest(..., 'INVALID_FOLDER_NAME')`;
  - `isFreePack(pack) => boolean`;
  - `publishProblem(pack, sampleCount: number) => null | 'PACK_EMPTY' | 'PACK_PAID_NOT_SELLABLE'`;
  - `ZIP_BUILD_TIMEOUT_MS = 30 * 60 * 1000`;
  - `zipBuildStatus(pack, now = Date.now()) => 'idle'|'building'|'failed'`;
  - `markZipStale(packId) => Promise`, which runs `SamplePack.updateOne({_id}, {$set: {'zip.stale': true}})`;
  - `publicPack(pack, counts: { itemsCount: number }) => { _id, slug, title, description, imageUrl, folderCount, itemsCount, priceArs, priceUsd, isFree, zip: { url, bytes } | null }`. Here `zip` is non-null only when the pack is free and `zip.url` is set. `imageUrl` goes through `buildPublicUrl`.

- [ ] **Step 1: Write the failing tests** in `tests/samplePacks.test.js`:
  - `slugify("Mastermind") === "mastermind"`, `slugify("Vol. 1 Ñandú") === "vol-1-nandu"`, and `slugify("  ") === "pack"`.
  - `uniqueSlug("Mastermind", exists)` returns `"mastermind-2"` when `exists` is true only for `"mastermind"`.
  - `cleanFolderName(" 808 ") === "808"`. It throws `INVALID_FOLDER_NAME` for `""`, for `"a/b"`, for `"a\\b"`, and for a 51-character name.
  - `publishProblem({priceArs: null}, 0) === 'PACK_EMPTY'`, `publishProblem({priceArs: 25000}, 5) === 'PACK_PAID_NOT_SELLABLE'` and `publishProblem({priceArs: null}, 5) === null`.
  - `zipBuildStatus`:
    - `'building'` when the build started 5 min ago;
    - `'failed'` when it started 31 min ago with status `'building'`;
    - `'idle'` when `zip` is missing.
  - `publicPack`: a paid pack with `zip.url` returns `zip: null` and `isFree: false`; a free pack returns `zip: { url, bytes }`.
  - Model validation without a DB, using `new Samples({...}).validateSync()`: it errors when `folder` is missing. `new SamplePack({title, description, type: 'samples'}).validateSync()` passes without `imageUrl`.
- [ ] **Step 2:** Run `npx jest tests/samplePacks.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - **`slugify`:** NFD normalisation, strip diacritics, lowercase, non-alphanumeric runs become `-`, trim `-`, fall back to `"pack"`.
  - **`cleanFolderName`:** trim; must be 1–50 characters and contain no `/`, `\` or control characters.
- [ ] **Step 4:** Run `npx jest tests/samplePacks.test.js`. Expected: PASS. Then run `npm run lint && npm test` for the whole suite: all green.
- [ ] **Step 5: Commit.** Message: `feat: sample pack folders, prices, publishing and zip state in the models`.

### Task 2 (B): Public sample pack API

**Files:**
- Modify: `routes/resourceRoutes.js`
- Test: `tests/samplePacksApi.test.js`. It uses `jest.mock` for `SamplePack` and `Samples`, like `api.test.js`.

**Interfaces:**
- **Consumes:** `publicPack` and `isFreePack` from Task 1.
- **Produces:**
  - `GET /api/resources/samplepacks` returns `publicPack[]`, filtered by `{ published: true }` and sorted by `createdAt` descending. `itemsCount` comes from `countByParent`.
  - `GET /api/resources/samplepacks/:slug` returns `publicPack` plus `folders: [{ name, samples: [{ _id, title, audioFile, durationSec }] }]`:
    - folders follow the `pack.folders` order;
    - samples within a folder are sorted by `title.localeCompare(b, 'es', { numeric: true })`;
    - an unknown or unpublished slug gets a 404 with code `PACK_NOT_FOUND`;
    - a sample whose folder is not in `pack.folders` is left out.
  - The `/samplepacks/:slug` route is declared **before** `/:resourceType`. The old `/samples/playlist/:id` keeps working until Task 11.

- [ ] **Step 1: Write the failing tests.**
  - The list only queries `{ published: true }`. A paid pack has `zip: null`.
  - The detail returns folders in pack order and sorts `"kick 10"` after `"kick 2"`.
  - An unpublished pack and an unknown slug both return 404 `PACK_NOT_FOUND`.
- [ ] **Step 2:** Run `npx jest tests/samplePacksApi.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement both handlers in `routes/resourceRoutes.js`.
- [ ] **Step 4:** Run `npx jest tests/samplePacksApi.test.js`, then `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: public sample pack showcase and detail by slug`.

### Task 3 (B): Admin API — packs, folders, samples

**Files:**
- Modify: `routes/adminRoutes.js` (the SAMPLE PACKS and SAMPLES sections)
- Test: `tests/samplePacksAdmin.test.js`. Mock `User` as an admin, like `api.test.js`.

**Interfaces:**
- **Consumes:** Task 1 helpers.
- **Produces.** Every response goes through `success()`. Errors use the codes below.

  | Method and route | Body | Behaviour |
  |---|---|---|
  | `GET /api/admin/samplepacks` | — | Every pack, with `itemsCount` and `zip.build.status` taken from `zipBuildStatus` |
  | `POST /samplepacks` | `title`, `description`, `imageUrl?`, `folders?`, `priceArs?`, `priceUsd?` | `slug` from `uniqueSlug`; `published: false` |
  | `PUT /samplepacks/:id` | `title?`, `description?`, `imageUrl?`, `priceArs?` (number or null), `priceUsd?`, `published?` | `published: true` runs `publishProblem`, which can return 409 `PACK_EMPTY` or `PACK_PAID_NOT_SELLABLE`. A title change sets `zip.stale`. **The slug never changes.** |
  | `POST /samplepacks/:id/folders` | `name` | Adds a folder; 409 `FOLDER_EXISTS` if the name is taken, case-insensitive |
  | `PUT /samplepacks/:id/folders` | `from`, `to` | Renames the folder, runs `Samples.updateMany` on the samples in it, sets `zip.stale`. 404 `FOLDER_NOT_FOUND`; 409 `FOLDER_EXISTS` |
  | `PUT /samplepacks/:id/folders/order` | `folders: string[]` | The list must be a permutation of the current folders, otherwise 400 `INVALID_FOLDER_ORDER` |
  | `DELETE /samplepacks/:id/folders/:name` | — | 409 `FOLDER_NOT_EMPTY` if the folder has samples |
  | `POST /samplepacks/:id/samples` and `/samples/batch` | as today, plus `folder` per sample | `folder` must be in `pack.folders`, otherwise 400 `UNKNOWN_FOLDER`. Calls `markZipStale` |
  | `PUT /samples/:id` | plus `folder?` | Same check against the sample's own pack. A change of `folder` or `audioFile` calls `markZipStale` |
  | `DELETE /samples/:id` | — | Calls `markZipStale` |
  | `POST /samplepacks/:id/duplicate` | — | Copies `folders`, the prices and each sample's `folder`, and gets a new slug. The copy is unpublished and has no `zip` |

- [ ] **Step 1: Write the failing tests**, one per row's main rule:
  - publishing a paid pack returns 409 `PACK_PAID_NOT_SELLABLE`;
  - publishing an empty pack returns 409 `PACK_EMPTY`;
  - adding `"drums"` when `"Drums"` exists returns 409 `FOLDER_EXISTS`;
  - renaming calls `Samples.updateMany({ samplepackId, folder: 'Drums' }, { $set: { folder: 'Kicks' } })` and sets the stale flag;
  - deleting a non-empty folder returns 409;
  - a sample with `folder: 'Nope'` returns 400 `UNKNOWN_FOLDER`;
  - a batch with one bad folder inserts nothing;
  - an order that is not a permutation returns 400.
- [ ] **Step 2:** Run `npx jest tests/samplePacksAdmin.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. Folder names go through `cleanFolderName`. Prices are validated as `isFloat({ min: 0 })` or null.
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: admin API for pack folders, prices and publishing`.

### Task 4 (B): ZIP builder

**Files:**
- Modify: `package.json` (add `archiver`), `services/b2Service.js`
- Create: `services/zipService.js`, `utils/wavDuration.js`, `tests/zipService.test.js`, `tests/wavDuration.test.js`

**Interfaces — Produces:**
- **`b2Service.uploadLargeStream(readable, key, { mime, cacheControl }) => Promise<{ url, key, bytes, fileId }>`:**
  - Collects 10 MB parts (`PART_SIZE`) and uploads them one at a time with `startLargeFile`, `getUploadPartUrl`, `uploadPart` and `finishLargeFile`, retrying each part up to 3 times.
  - If the whole stream fits in one part, it uses a normal `uploadFile` instead.
  - On any error it calls `cancelLargeFile` and rethrows as `STORAGE_UPLOAD_FAILED`.
  - Sets `fileInfo: { 'b2-cache-control': cacheControl }`.
- **`b2Service.deleteFile(key, fileId) => Promise<void>`.**
- **`wavDurationSec(header: Buffer) => number | null`:**
  - Parses RIFF/WAVE, reads `byteRate` from `fmt ` and the size of the `data` chunk, and returns `dataSize / byteRate` rounded to 0.01.
  - Returns null when the header is not a WAV or a chunk is missing from the first 64 KB.
- **`zipEntries(pack, samples) => Array<{ name, url, sampleId }>`:**
  - Folder order, then title (numeric compare).
  - Each name is `safe(pack.title)/safe(folder)/safe(title)<ext>`. `safe` replaces `\ / : * ? " < > |` and control characters with `_`. `ext` comes from the `audioFile` path and defaults to `.wav`.
  - Duplicate names get ` (2)`, ` (3)` and so on.
- **`buildPackZip(packId, deps = { b2, http, SamplePack, Samples, now }) => Promise<void>`:**
  1. Fetches the pack and its samples.
  2. Streams each `buildPublicUrl(audioFile)` through `http.get(url, { responseType: 'stream' })` into the archive, one after another. It peeks at the first chunk to store `durationSec` on the sample.
  3. Pipes the archive into `uploadLargeStream`.
  4. **On success:** sets `zip = { url, key, fileId, bytes, builtAt: now(), stale: false, build: { status: 'idle', startedAt: null, error: null } }`, then deletes the previous ZIP file if there was one.
  5. **On failure:** sets `zip.build = { status: 'failed', error: 'No se pudo armar el ZIP: <sample title o motivo>' }` and leaves the previous `zip.url`, `bytes` and `fileId` untouched.

- [ ] **Step 1: Write the failing tests.**
  - **`wavDuration.test.js`:** build a 44-byte header in the test (44100 Hz, 16-bit, stereo, data size 176400). Expect `1`. Expect `null` for `Buffer.from('not a wav')`.
  - **`zipService.test.js`:**
    - `zipEntries` with two `"kick"` samples in Drums gives `Mastermind/Drums/kick.wav` and `Mastermind/Drums/kick (2).wav`.
    - A title `"a/b:c"` becomes `a_b_c.wav`.
    - Folders follow the pack order.
    - `buildPackZip` with fake `http` streams (two small WAV buffers) and a fake `b2`: the concatenated uploaded bytes start with `PK`, contain both entry names, and the pack update sets `zip.url` and `stale: false` and deletes the old `fileId`.
    - `buildPackZip` where `http.get` rejects with 404 for the second sample: the pack update sets `build.status: 'failed'` with an error containing that sample's title, `deleteFile` is not called, and `zip.url` is not overwritten.
  - **`uploadLargeStream`:** a 25 MB stream gives 3 parts and `finishLargeFile` with 3 SHA-1 hashes. A 1 MB stream calls `uploadFile` once. A failing part calls `cancelLargeFile`.
- [ ] **Step 2:** Run `npx jest tests/zipService.test.js tests/wavDuration.test.js`. Expected: FAIL.
- [ ] **Step 3:** Run `npm i archiver`, then implement.
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: build sample pack ZIPs by streaming WAVs from B2 into a large-file upload`.

### Task 5 (B): Admin ZIP endpoint

**Files:**
- Modify: `routes/adminRoutes.js`, `tests/samplePacksAdmin.test.js`

**Interfaces:**
- **Consumes:** `buildPackZip` and `zipBuildStatus`.
- **Produces:** `POST /api/admin/samplepacks/:id/zip`:
  - 202 with `{ status: 'building' }`. It sets `zip.build = { status: 'building', startedAt: now, error: null }`, then calls `buildPackZip(id)` without awaiting it, logging errors with `.catch`.
  - 409 `ZIP_BUILDING` when `zipBuildStatus` is `'building'`.
  - 409 `PACK_EMPTY` when the pack has no samples.
  - 404 when the pack does not exist.
- The admin polls `GET /api/admin/samplepacks`.

- [ ] **Step 1: Write the failing tests.**
  - The endpoint returns 202 and `buildPackZip` is called once, with the service mocked through `jest.mock('../services/zipService')`.
  - A pack building for 5 min returns 409. One that started 31 min ago returns 202.
- [ ] **Step 2:** Run `npx jest tests/samplePacksAdmin.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: admin endpoint to build a pack ZIP in the background`.

### Task 6 (B): Migration script and docs

**Files:**
- Create: `scripts/migrate-samplepacks.js`, `tests/migrateSamplePacks.test.js`, `docs/decisions/0005-sample-packs-with-folders.md`
- Modify: `README.md`, `README.es.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/architecture.md`, `package.json` (script `migrate:samplepacks`)

**Interfaces — Produces:**
- **`planSamplePackMigration(oldPacks, counts, order = ['Drums','808','Bass','Synths','Fxs']) => { folders: string[], moves: [{ fromId, folder, count }], total }`:**
  - Packs whose title is not in `order` are added after it, by title.
  - Packs named Mastermind are skipped.
- **CLI, `node scripts/migrate-samplepacks.js [--apply] [--delete-old]`:**
  - **No flag:** dry run. Prints the plan only.
  - **`--apply`:**
    1. Finds or creates the pack with slug `mastermind`: title `Mastermind`, description `Drums, 808s, bajos, synths y FX de niv0. Gratis para tus producciones.`, `type: 'samples'`, no image, `published: false`.
    2. Sets `folders`.
    3. Runs `Samples.updateMany({ samplepackId: fromId }, { $set: { samplepackId: master._id, folder } })` for each move.
    4. Re-counts per folder and aborts with a non-zero exit if a count differs.
    5. Publishes Mastermind and sets `published: false` on the old packs.
  - **`--delete-old`:** deletes old packs that have 0 samples, and nothing else. **Only run it with Nicolás's explicit OK.**
  - It is idempotent: a second `--apply` moves 0 samples and still verifies the totals.

- [ ] **Step 1: Write the failing test.** Given packs `Fxs`, `808`, `Synths`, `Drums` and `Bass` with counts 36, 42, 41, 104 and 24:
  - `folders` is `['Drums','808','Bass','Synths','Fxs']` and `total` is `247`;
  - adding a pack named `Mastermind` changes nothing;
  - an extra pack named `Vox` ends up last.
- [ ] **Step 2:** Run `npx jest tests/migrateSamplePacks.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the script. Use `require.main === module` for the CLI, with the same dotenv and mongoose setup as `scripts/migrate.js`.
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Docs.**
  - **ADR 0005:** why packs have folders, the published/paid rule, the ZIP build design and the 512 MB limit.
  - **`CLAUDE.md`:** replace "Sample pack WAVs stay free" with the new rule. Sample WAVs can be heard; the pack is downloaded as a ZIP only; paid packs cannot be published until the store exists. Add the folder and stale-ZIP conventions.
  - **README and architecture:** the new endpoints.
  - **CHANGELOG:** an Unreleased entry.
- [ ] **Step 6: Commit.** Message: `feat: migration script to merge the old packs into Mastermind`, then a separate commit `docs: ADR 0005 sample packs with folders and ZIP downloads`. Push and open a PR into `main`.
- [ ] **Step 7 (STOP, ask Nicolás):** after the PR is merged and Render has deployed, run the dry run and show him the output. Run `--apply` only after his OK. Never run `--delete-old` without a separate OK.

### Task 7 (F): API client, price formatting, showcase

**Files:**
- Modify: `src/services/api.js`, `src/components/common/CatalogConsole.jsx` (+css, + test), `src/components/SamplePacks.jsx`, `src/i18n/es.json`, `src/i18n/en.json`
- Create: `src/utils/formatPrice.js`, `src/components/samplepacks/PackCover.jsx` (+ `SamplePacks.css`, shared), tests `src/utils/formatPrice.test.js`, `src/components/samplepacks/PackCover.test.jsx`, `src/components/SamplePacks.test.jsx`

**Interfaces — Produces:**
- **`samplePacksService`:**
  - `getAll()` calls `GET /api/resources/samplepacks`;
  - `getBySlug(slug)` calls `GET /api/resources/samplepacks/${encodeURIComponent(slug)}`.
- **`adminService.samplepacks` adds:**
  - `addFolder(id, name)`;
  - `renameFolder(id, from, to)`;
  - `reorderFolders(id, folders)`;
  - `deleteFolder(id, name)`;
  - `buildZip(id)`.
- **`formatPackPrice(pack, lang) => string`:**
  - In `en`, when `priceUsd` is set, it uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`.
  - Otherwise it formats `priceArs` with `('es-AR', ARS)`.
- **`formatBytes(bytes) => string`:** `"143 MB"`, also in `formatPrice.js`.
- **`PackCover({ title, imageUrl })`:**
  - With an image, it renders the `<img>`.
  - Without one, it renders the generated cover: `div.pack-cover-generated` with the title in Orbitron on an amber gradient, `aria-hidden`.
- **`CatalogConsole` gets three optional props** (defaults keep Beats and Loops exactly as they are):
  - `getHref(item) => string` (default `/${resourceType}/playlist/${item._id}`);
  - `getMeta(item) => string` (default the count by `resourceType`), shown in each bar and under the record;
  - `getBadge(item) => string | null` (default `null`), shown in each bar as a small tag and under the record.
  - When the selected item has no `imageUrl` and the caller passes `renderLabelFallback(item)`, its result is rendered inside the record label instead of the plain amber label.
- **Showcase (`SamplePacks.jsx`):** `CatalogConsole` with the published packs:
  - `getHref`: `/samplepacks/${pack.slug}`;
  - `getMeta`: `t('samplePacks.meta', { folders: pack.folderCount, samples: pack.itemsCount })`;
  - `getBadge`: `t('samplePacks.free')` when `pack.isFree`, else `formatPackPrice(pack, lang)`;
  - `renderLabelFallback`: `<PackCover title imageUrl={null} />` (the generated cover, round, inside the label);
  - `useConsoleNav({ back: '/homelogued' })` (already there).
- **New i18n keys (ES / EN):**
  - `samplePacks.free`: "GRATIS" / "FREE";
  - `samplePacks.meta`: "{{folders}} carpetas · {{samples}} samples" / "{{folders}} folders · {{samples}} samples";
  - the `samplePacks.download*`, `samplePacks.zip*` and `samplePacks.browser*` keys are added in Tasks 8–9.

- [ ] **Step 1: Write the failing tests.**
  - `formatPackPrice({priceArs: 25000}, 'es')` matches `/25\.000/`.
  - `formatPackPrice({priceArs: 25000, priceUsd: 15}, 'en')` matches `/\$15/`.
  - `formatPackPrice({priceArs: 25000}, 'en')` matches `/25,000/`.
  - `formatBytes(149946368) === "143 MB"`.
  - `SamplePacks` (service mocked) renders a `CatalogConsole` link to `/samplepacks/mastermind` showing "GRATIS" and "5 carpetas · 247 samples", and the record label shows the generated cover with the text "Mastermind" when `imageUrl` is null.
  - `CatalogConsole` existing tests still pass unchanged (Beats/Loops defaults); a new test covers `getHref`, `getMeta` and `getBadge`.
- [ ] **Step 2:** Run `npx vitest run src/utils/formatPrice.test.js src/components/samplepacks`. Expected: FAIL.
- [ ] **Step 3:** Implement, and switch `SamplePacks.jsx` to `CatalogConsole`.
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: sample pack showcase on the catalog console with price badge and generated cover`.

### Task 8 (F): SampleBrowser

**Files:**
- Create: `src/components/samplepacks/SampleBrowser.jsx`, `SampleBrowser.css`, `SampleBrowser.test.jsx`
- Modify: `src/hooks/useConsoleNav.js`, `src/hooks/useConsoleNav.test.jsx`

**Interfaces:**
- **Consumes:** the `player` object from `usePlaylistPlayer`: `{ currentIndex, isPlaying, isLoading, currentTime, duration, toggleTrack(index) }`.
- **Produces:** `SampleBrowser({ folders, player })`, where `folders` is `[{ name, samples: [{ _id, title, durationSec }] }]`. The player index of a sample is its position in `flattenFolders(folders)`, which is exported from the same file as `flattenFolders(folders) => sample[]` in folder order.
- **Markup:**
  - `div.sample-browser` holds a now-playing bar and a `ul[role=tree][aria-label=t('samplePacks.browserLabel')]`.
  - Folders are `li[role=treeitem][aria-expanded]` with a nested `ul[role=group]`.
  - Samples are `li[role=treeitem]` with `aria-selected` set when playing, plus the title and a duration `m:ss` when `durationSec` is set.
  - **Roving tabindex:** only one item has `tabIndex=0`.
- **Behaviour:**
  - Only the first folder starts open. Clicking a folder toggles it.
  - Clicking a sample calls `toggleTrack(flatIndex)`.
  - **Keys:**
    - ArrowDown and ArrowUp move between visible items;
    - ArrowRight opens a folder, or moves into it if it is already open;
    - ArrowLeft closes a folder, or moves from a sample to its folder;
    - Enter and Space toggle a folder or play a sample;
    - Home and End go to the first and last item.
  - **The now-playing bar:**
    - shows `${folder} · ${title}` and a `div[role=progressbar]` with `aria-valuenow = round(currentTime / duration * 100)`;
    - shows `t('samplePacks.browserIdle')` when nothing is playing.
  - The look follows the mockup: FL dark grey `#2d3238` and `#23272c`, amber folder icons, an orange sample icon, and a playing row with an amber left edge. All of it is defined as CSS variables in the component, with amber taken from the tokens.
  - Reduced motion: no transitions.
  - Mobile (≤768px): full width, rows at least 40px tall so they are easy to tap.
  - **No download control anywhere.**
  - **Coexists with `useConsoleNav`** (the page-level arrows): the tree calls `preventDefault()` on every key it handles, and `useConsoleNav` (frontend `src/hooks/useConsoleNav.js`) is changed to ignore arrow and Enter events that are already `defaultPrevented`, as it already does for Esc. Tree items do not carry `data-nav-item`. Add a hook test: an ArrowDown with `defaultPrevented` does not move the page selection.
- **i18n keys:**
  - `samplePacks.browserLabel`: "Contenido del pack" / "Pack contents";
  - `samplePacks.browserIdle`: "Tocá un sample para escucharlo" / "Click a sample to hear it".

- [ ] **Step 1: Write the failing tests**, with a fake `player` that records `toggleTrack` calls:
  - It renders a tree with 2 folders; only the first has `aria-expanded="true"`.
  - Clicking the sample in the second folder, after opening it, calls `toggleTrack` with the flat index (for example `2` when the first folder has 2 samples).
  - ArrowDown from the first folder focuses its first sample. ArrowLeft from a sample focuses its folder.
  - With `currentIndex: 1` the second sample has `aria-selected="true"`, and the bar shows `"Drums · snare"`.
  - `durationSec: 2.4` renders `0:02`.
  - `queryByRole('button', { name: /descarg|download/i })` is null.
- [ ] **Step 2:** Run `npx vitest run src/components/samplepacks/SampleBrowser.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: FL-style sample browser with keyboard tree navigation`.

### Task 9 (F): Pack page and routes

**Files:**
- Create: `src/components/samplepacks/SamplePackPage.jsx`, `SamplePackPage.test.jsx`
- Modify: `src/routes/MyRoutes.jsx`, `src/components/CardPlaylist.jsx` (drop the samples branch), i18n
- Delete: `src/components/Samples.jsx`, `src/components/Samples.test.jsx`

**Interfaces:**
- **Consumes:** `samplePacksService.getBySlug`, `PackCover`, `SampleBrowser`, `flattenFolders`, `formatBytes` and `formatPackPrice`.
- **Produces:** the route `/samplepacks/:slug` behind `PrivateRoute`, plus:
  - `/samples` and `/samples/samplepack/:samplepackId` redirect to `/samplepacks` with `<Navigate replace />`.
  - The page has `SEO`, `PageBackground` (`PAGE_BACKGROUNDS.samplePacks`), `PageHeader`, the cover, an `h1` title and the description, then the ZIP control, then `SampleBrowser`, then the "Volver a sample packs" link (the existing `nav.backToPacksShort`).
  - `useConsoleNav({ back: '/samplepacks' })`; the ZIP link carries `data-nav-item`.
  - **The ZIP control:**
    - **free pack with `zip`:** `<a href={zip.url} download className="pack-zip-btn">` with the text `t('samplePacks.downloadZip')` and `formatBytes(zip.bytes)`;
    - **free pack without `zip`:** a disabled button, `t('samplePacks.zipPending')`;
    - **paid pack:** a disabled button, `t('samplePacks.comingSoon')`, plus the price.
  - Player: `usePlaylistPlayer(flattenFolders(folders), { autoAdvance: false, meta: { album: title, artwork: imageUrl } })`.
  - A 404 shows `t('samplePacks.notFound')` and the back link.
- **i18n keys (ES / EN):**
  - `downloadZip`: "DESCARGAR ZIP" / "DOWNLOAD ZIP";
  - `zipPending`: "ZIP en preparación" / "ZIP coming soon";
  - `comingSoon`: "Próximamente" / "Coming soon";
  - `notFound`: "Este pack no existe o no está disponible." / "This pack doesn't exist or isn't available."

- [ ] **Step 1: Write the failing tests**, mocking `samplePacksService`:
  - the free pack with a zip shows a link with `href` set to the zip URL and the text "143 MB";
  - without a zip, the button is disabled with "ZIP en preparación";
  - a paid pack shows "Próximamente";
  - a 404 rejection shows the not-found text;
  - rendering `MyRoutes` at `/samples/samplepack/abc` ends at the showcase. Mock the service and the auth the way the existing route tests do, or test the `Navigate` element directly.
- [ ] **Step 2:** Run `npx vitest run src/components/samplepacks/SamplePackPage.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement, and delete `Samples.jsx`. Remove its imports and fix the tests that referenced it, such as `CardPlaylist.test.jsx`.
- [ ] **Step 4:** Run `npm run lint && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat: sample pack page with ZIP download and browser; redirect old sample routes`.

### Task 10 (F): Admin — pack form, folders, ZIP panel, docs

**Files:**
- Create in `src/components/admin/`: `AdminSamplePackForm.jsx`, `AdminPackFolders.jsx`, `AdminZipPanel.jsx`, with tests `AdminSamplePackForm.test.jsx` and `AdminZipPanel.test.jsx`
- Modify:
  - `src/routes/MyRoutes.jsx`: `samplepacks/new` and `:id/edit` now use `AdminSamplePackForm`;
  - `AdminPlaylistForm.jsx`: drop `isSamplePack`;
  - `AdminSamples.jsx`: the folder select, the folders panel and the ZIP panel;
  - `AdminSamplePacks.jsx`: Publicado/Borrador and Gratis/price badges;
  - the i18n files;
  - `CLAUDE.md`, `README.md`, `CHANGELOG.md`;
  - `docs/decisions/0007-sample-pack-browser.md` (new).

**Interfaces:**
- **Consumes:** the Task 7 `adminService` additions and the API from Tasks 3 and 5.
- **`AdminSamplePackForm`:**
  - Fields: title, description, cover (`AdminUploader`, optional), "Gratis" checkbox (checked means `priceArs: null`), ARS and USD prices (shown when not free; ARS required), and "Publicado" (edit only).
  - Errors 409 `PACK_EMPTY` and `PACK_PAID_NOT_SELLABLE` show `t('admin.samplePacks.errors.<code>')`:
    - "Subí al menos un sample antes de publicar";
    - "Los packs pagos se publican cuando esté la tienda".
- **`AdminPackFolders({ pack, samplesByFolder, onChange })`:**
  - lists the folders with their sample count;
  - lets the admin add, rename, move up/down (through `reorderFolders`) and delete (disabled when not empty);
  - shows a toast with the server's error code text.
- **`AdminZipPanel({ pack, onRefresh })`:**
  - **No ZIP:** "Todavía no hay ZIP".
  - **Ready:** the date, `formatBytes` and a link.
  - **`zip.stale`:** the warning "Hay cambios: volvé a armar el ZIP".
  - **`build.status === 'building'`:** "Armando ZIP…", with the button disabled. It polls `onRefresh` every 5 s, and the timer is cleared on unmount.
  - **`'failed'`:** `build.error`.
  - The button "Armar ZIP" calls `buildZip(id)`.
- **`AdminSamples`:**
  - the single and batch forms require a folder select, and batch uploads go to the chosen folder;
  - the table has a folder column with a select that moves the sample (`samples.update(id, { folder })`);
  - a filter by folder.

- [ ] **Step 1: Write the failing tests.**
  - **Form:** with "Gratis" unchecked and ARS empty, it shows a validation error and does not call `update`. With the server answering 409 `PACK_PAID_NOT_SELLABLE`, the Spanish message appears.
  - **ZipPanel:**
    - the stale warning shows when `zip.stale` is true;
    - "Armando ZIP…" shows and the button is disabled while building;
    - with fake timers, `onRefresh` is called after 5 s and stops after unmount;
    - clicking "Armar ZIP" calls `adminService.samplepacks.buildZip('p1')`.
- [ ] **Step 2:** Run `npx vitest run src/components/admin`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run lint && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Docs.**
  - **ADR 0007 (frontend):** the showcase, the browser and the deliberate absence of per-sample downloads.
  - **`CLAUDE.md`:** the sample pack rules.
  - **README:** the pages table.
  - **CHANGELOG:** the Unreleased entry.
- [ ] **Step 6: Commit.** Message: `feat: admin for pack folders, prices, publishing and ZIP builds`, then a separate commit `docs: ADR 0007 sample pack browser`. Push and open a PR into `main`.
- [ ] **Step 7 (STOP):** Nicolás tests locally and merges. Then verify production: `/samplepacks` shows only Mastermind, the browser plays, and the ZIP downloads once he has built it from the admin.

### Task 11 (B): Lock single-sample downloads

**Files:**
- Modify: `utils/downloadSource.js`, `tests/downloadSource.test.js`, `tests/downloads.test.js`, `CLAUDE.md`, `CHANGELOG.md`

**Interfaces — Produces:** `isLicensedOriginal(key)` also matches `^samples/`. ZIP keys (`samplepacks/…`) stay allowed: they are served directly from B2 and never go through these endpoints anyway.

- [ ] **Step 1: Write the failing tests.**
  - `isLicensedOriginal('samples/123-kick.wav') === true` and `isLicensedOriginal('samplepacks/mastermind-x.zip') === false`.
  - `GET /api/download/link?url=<bucket>/samples/x.wav` is refused with the same status and code as the beats case.
- [ ] **Step 2:** Run `npx jest tests/downloadSource.test.js tests/downloads.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement, and rename the comment and the function intent: it now covers "files that are not downloaded one by one".
- [ ] **Step 4:** Run `npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `fix: refuse single-sample downloads now that packs download as a ZIP`. Branch `feat/lock-sample-downloads`, then a PR. It merges only after Task 10 is in production.
