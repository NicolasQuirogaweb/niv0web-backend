# niv0web API

[![CI](https://github.com/NicolasQuirogaweb/niv0web-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/NicolasQuirogaweb/niv0web-backend/actions/workflows/ci.yml)

Backend for **niv0 prod**, the site where I publish my beats, loops and sample packs. Anyone with a Google account can listen and download. I manage the catalog from an admin panel, and the audio files live in Backblaze B2.

I built niv0 so that when someone asks me "do you have beats I can use?", I can answer with a single link. Artists can browse my beats, loops and sample packs, listen to everything and download what they need, instead of waiting for me to send files one by one. It was also an excuse to build a music app of my own and have full control over how my catalog is shown.

The functionality is where I want it: an interactive catalog and a bridge to contact me. The UI and UX are still evolving while I find the look that fits.

Frontend: [niv0web-frontend](https://github.com/NicolasQuirogaweb/niv0web-frontend) · Live site: [niv0web.vercel.app](https://niv0web.vercel.app)

> Versión en español: [README.es.md](README.es.md)

## Stack and why

| | Choice | Why |
|---|---|---|
| Runtime | Node 22 + Express 4 | A small REST API. Express has everything this needs and nothing it doesn't. |
| Database | MongoDB (Mongoose) | Catalogs and tracks are documents with a parent id. There are no joins beyond counts. |
| Files | Backblaze B2 | Cheaper than S3 for storing and serving audio. The API uploads, and clients stream straight from B2. |
| Auth | Google Sign-In + JWT in httpOnly cookies | No passwords to store. Cookies keep tokens out of JavaScript ([ADR 0001](docs/decisions/0001-httponly-cookies.md)). |
| Validation | Zod (env) + express-validator (requests) | The app refuses to start with a bad config, and rejects bad input with a 400 before it reaches Mongo. |
| Hosting | Docker on Render | The same image runs locally and in production ([ADR 0003](docs/decisions/0003-docker-on-render.md)). |

## Run it locally

```bash
cp .env.example .env        # fill in Mongo, B2 and Google values
npm install
npm run dev                 # http://localhost:5000, reloads on change
npm test                    # no database or B2 needed, they're mocked
```

With Docker:

```bash
docker build -t niv0web-api .
docker run --env-file .env -p 5000:5000 niv0web-api
```

`--env-file` is required. The image doesn't carry secrets, and `config/env.js` exits on startup if any variable is missing.

To make your user an admin, log in once from the frontend and then run `npm run migrate -- you@gmail.com`.

## Environment variables

These are validated in [`config/env.js`](config/env.js). The template is [`.env.example`](.env.example).

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | yes | 32+ characters each, and different from each other |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_ID`, `B2_BUCKET_NAME` | yes | |
| `B2_PUBLIC_URL` | yes | Base URL without the bucket, e.g. `https://s3.us-east-005.backblazeb2.com` |
| `GOOGLE_CLIENT_ID` | yes | Same client id as the frontend. Used to check the token's audience. |
| `FRONTEND_URL` | no | Allowed CORS origin. Default `http://localhost:3000` |
| `PORT`, `NODE_ENV` | no | Default `5000` / `development` |

## API

Every response has the shape `{ success, data, meta }` or `{ success: false, message, code }`.

**Auth** (`/api/auth`, 20 requests per 15 min per IP)

| Method | Path | |
|---|---|---|
| POST | `/google-login` | `{ credential }` from Google Sign-In. Sets `accessToken` (15 min) and `refreshToken` (7 days) cookies. |
| GET | `/verify-token` | Current user from the cookie. `Authorization: Bearer` also works, for curl. |
| POST | `/refresh` | Issues a new pair of cookies. A refresh token from before your last logout is rejected. |
| POST | `/logout` | Clears the cookies and invalidates your existing refresh tokens. |

**Public catalog** (`/api/resources`)

| Method | Path | |
|---|---|---|
| GET | `/playlists?type=beats\|loops` | Catalogs, each with `itemsCount` |
| GET | `/samplepacks` | Sample packs, each with `itemsCount` |
| GET | `/:type/playlist/:id` | A catalog with its tracks. `type` is `beats`, `loops` or `samples`. |
| GET | `/:type` | Every item of a type (`beats`, `loops`, `samples`, `prodmixmasters`) |

**Other**

| Method | Path | |
|---|---|---|
| GET | `/api/download/link?url=&name=` | Beat WAVs are refused with `403 LICENSE_REQUIRED` (they come with the license; the public catalog only exposes their MP3). Otherwise: signed B2 link (valid 5 min) that downloads the file as an attachment named after the track. The browser downloads straight from B2 ([ADR 0004](docs/decisions/0004-direct-downloads-from-b2.md)). |
| GET | `/api/download?url=` | Older proxy that streams the file through the API. Kept as a fallback. Both only accept URLs from our bucket ([why](docs/architecture.md#downloads)). |
| GET | `/health` | `{ ok, db }`. Render and the Docker `HEALTHCHECK` use it. |

**Admin** (`/api/admin`). Every route needs an admin, and the role is read from the database on each request.

- `POST /upload`, `POST /upload/batch`: multipart, up to 100 MB per file and 10 files per batch, 60 per minute. `folder` must be one of `uploads, beats, samples, loops, prodmixmasters, images, videos`. A WAV over 5 MB uploaded to `beats` or `loops` also gets an MP3 preview (192 kbps) for playback; the response includes `previewUrl` (or `null` if the conversion failed, which never fails the upload).
- `GET|POST /playlists`, `PUT|DELETE /playlists/:id`, `POST /playlists/:id/duplicate`
- `GET|POST /playlists/:id/beats`, `POST /playlists/:id/beats/batch`, `PUT|DELETE /beats/:id`
- `GET|POST /playlists/:id/loops`, `POST /playlists/:id/loops/batch`, `PUT|DELETE /loops/:id`
- `GET|POST /samplepacks`, `PUT|DELETE /samplepacks/:id`, `POST /samplepacks/:id/duplicate`
- `GET|POST /samplepacks/:id/samples`, `POST /samplepacks/:id/samples/batch`, `PUT|DELETE /samples/:id`
- `GET|POST /prodmixmasters`, `PUT|DELETE /prodmixmasters/:id`
- `GET /users`, `PUT /users/:id/role`
- `GET /dashboard`: counts, with beat and loop catalogs reported separately

A beat can't be created in a loops catalog, or in one that doesn't exist. PUT routes validate the same fields as POST.

## Project layout

```
app.js            Express app: middleware, routes, download proxy (no listen(), so tests can import it)
server.js         connects to Mongo, then listens, and handles graceful shutdown
config/           env validation (zod) and Mongo connection
routes/           auth, public catalog (resourceRoutes), admin
middleware/       adminAuth, errorHandler, rate limiters, validate
models/           Mongoose schemas
services/         b2Service: upload to B2 with retries
utils/            ApiError, response helpers, URL and download-source helpers
scripts/migrate   one-off: promote an admin, move old loops into a catalog
tests/            supertest against the real app, with models mocked
```

More detail in [docs/architecture.md](docs/architecture.md).

## Decisions

Short write-ups of the choices that shaped the code, with the trade-offs I accepted:

- [0001 — Tokens in httpOnly cookies, not localStorage](docs/decisions/0001-httponly-cookies.md)
- [0002 — Files in Backblaze B2, not on the server](docs/decisions/0002-backblaze-b2.md)
- [0003 — Docker on Render](docs/decisions/0003-docker-on-render.md)
- [0004 — Direct downloads from B2, and MP3 previews for WAVs](docs/decisions/0004-direct-downloads-from-b2.md)

## Known limitations

These are things I know about and decided not to fix yet:

- Lists aren't paginated. With the current catalog size (tens of items) it doesn't matter.
- Deleting a catalog removes its documents but not the files in B2. The files stay orphaned in the bucket.
- Cascade deletes don't run in a Mongo transaction.
- API error messages are in Spanish. The admin panel is in Spanish and I'm its only user.
- Render's free plan sleeps after 15 minutes. A GitHub Actions cron (`.github/workflows/keep-warm.yml`) pings `/health` every 10 minutes to keep it awake. GitHub pauses scheduled workflows after 60 days without repo activity; if that happens, re-enable it from the Actions tab.

**What I'd do next**

- A proper license flow: license types with their terms, and checkout. Today it's handled by contacting me directly.
- Delete the files in B2 when a catalog or track is deleted, so the bucket doesn't accumulate orphans.
- Pagination on the catalog endpoints, once the catalog grows enough to need it.

## Working with AI

I build this with Claude Code as a pair programmer. The repo carries the context an agent needs so I don't have to repeat it every session:

- [`CLAUDE.md`](CLAUDE.md): commands, architecture, conventions, and what not to touch.
- [`.claude/settings.json`](.claude/settings.json): which commands it can run without asking, no access to `.env`, and a hook that runs ESLint on every file it edits.
- [`.claude/skills/`](.claude/skills): step-by-step guides for repetitive tasks (adding a resource type, the pre-release checklist).

I use AI to move faster, not to stop thinking. I read what I ask for and what I get back, and I check every change before it goes in. It's a powerful tool, which is exactly why I keep studying it and following the practices that get the most out of it. This repo's setup is part of that.

## License

[MIT](LICENSE)
