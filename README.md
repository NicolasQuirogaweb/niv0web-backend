# 🎵 niv0web API — Backend

[![Node](https://img.shields.io/badge/node-20-339933?logo=node.js)](.nvmrc)
[![Express](https://img.shields.io/badge/express-4.21-000?logo=express)](package.json)
[![MongoDB](https://img.shields.io/badge/MongoDB-8.7-47A248?logo=mongodb)](package.json)
[![Backblaze B2](https://img.shields.io/badge/Backblaze_B2-Cloud_Storage-E6162D)](https://www.backblaze.com/cloud-storage)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](Dockerfile)
[![Render](https://img.shields.io/badge/Deployed-Render-46E3B7?logo=render)](https://render.com)

RESTful API for **niv0 prod** — a digital audio marketplace for beats, samples, loops, and prod-mix-master services. Handles authentication, resource management, file uploads to Backblaze B2, and an administrative CRUD dashboard.

---

## Architecture

```
                         ┌──────────────────────────────────────┐
                         │        Frontend (Vercel)             │
                         │   niv0web.vercel.app                 │
                         └────────────────┬─────────────────────┘
                                          │ HTTPS
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express API Server (:5000)                    │
│                                                                  │
│  helmet → compression → rate-limit → cors → cookie-parser       │
│       → body-parser                                              │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐    │
│  │ /api/auth │  │ /api/resources│  │ /api/admin (protected) │    │
│  │ Google OA │  │ (public GETs) │  │ CRUD: beats, loops,   │    │
│  │ JWT +     │  │ playlists,   │  │ samples, packs, users, │    │
│  │ Refresh   │  │ beats, etc.  │  │ prodmix, uploader      │    │
│  └─────┬─────┘  └──────┬───────┘  └───────────┬────────────┘    │
│        │               │                      │                  │
│        │               │     /api/download     │                  │
│        │               └──── (B2 file proxy) ──┘                  │
│        ▼                                                        │
│  /health (monitoring)                                           │
└────────┬────────────────────────┬───────────────────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐  ┌──────────────────────────────┐
│    MongoDB        │  │     Backblaze B2             │
│  (Mongoose ODM)   │  │   (Object Storage)           │
│                   │  │                              │
│  Collections:     │  │  Folders:                    │
│   users           │  │   beats/                     │
│   playlists       │  │   samples/                   │
│   beats           │  │   loops/                     │
│   loops           │  │   prodmixmasters/            │
│   samplepacks     │  │   uploads/                   │
│   samples         │  │                              │
│   prodmixmasters  │  │  Public CDN via B2_PUBLIC_URL│
└──────────────────┘  └──────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js 20 | LTS runtime |
| **Framework** | Express 4.21 | HTTP routing & middleware |
| **Database** | MongoDB + Mongoose 8.7 | Document store & ODM |
| **Auth** | Google OAuth 2.0 + JWT | Passwordless login |
| **Tokens** | `jsonwebtoken` 9.x | Access (15m) + Refresh (7d) |
| **File Storage** | Backblaze B2 | Cloud object storage |
| **HTTP Client** | Axios 1.7 | Token verification, file proxy |
| **Validation** | Zod 4.4 + express-validator | Schema + request validation |
| **Security** | Helmet 7.1, CORS, express-rate-limit | HTTP hardening |
| **Uploads** | Multer 2.1 | Multipart file handling |
| **Container** | Docker (Alpine) | Production packaging |
| **Hosting** | Render | Cloud deployment |

---

## Features

- **Passwordless Google OAuth login** — id_token verified server-side, JWT issued
- **JWT access + refresh token rotation** — 15-min access tokens with 7-day httpOnly refresh cookies
- **Public resource browsing** — playlists, beats, samples, loops, prod-mix-masters (no auth required)
- **Full admin CRUD** — users, playlists, beats, loops, samples, sample packs, prod-mix-masters, uploads
- **Batch upload** — multiple files in a single request with smart retry to Backblaze B2
- **Cascade deletes** — removing a playlist deletes its children; same for sample packs
- **Resource duplication** — deep-copy entire playlists/sample packs with all items
- **B2 file proxy** — `/api/download` bypasses CORS for client-side downloads
- **Rate limiting** — three tiers: general (100/min), auth (20/15min), upload (10/min)
- **Centralized error handling** — uniform `{ success, message, code }` responses
- **Environment validation** — Zod schema fails fast on missing/misconfigured env vars
- **Graceful shutdown** — SIGTERM/SIGINT closes connections cleanly
- **Dockerized** — minimal `node:20-alpine` image for production

---

## Project Structure

```
api-niv0web/
├── server.js                  # Entry point: middleware, routes, startup
├── package.json
├── .nvmrc                     # Node version pinning (20)
├── Dockerfile                 # Production build with Alpine
├── .dockerignore
├── .npmrc                     # legacy-peer-deps for CI
│
├── config/
│   ├── env.js                 # Zod env validation (fails fast)
│   └── db.js                  # MongoDB connection with pool
│
├── middleware/
│   ├── authenticateJWT.js     # JWT verification (Bearer token)
│   ├── adminAuth.js           # JWT + admin role check (DB lookup)
│   ├── asyncHandler.js        # Async error wrapper
│   ├── errorHandler.js        # Central error handler (7 error types)
│   ├── rateLimiter.js         # 3-tier rate limiting
│   └── validate.js            # express-validator wrapper
│
├── routes/
│   ├── auth.js                # Auth endpoints (4 routes)
│   ├── resourceRoutes.js      # Public resource endpoints (4 routes)
│   └── adminRoutes.js         # Admin CRUD (30+ routes)
│
├── models/
│   ├── User.js
│   ├── Playlist.js
│   ├── Beat.js
│   ├── Loops.js
│   ├── SamplePack.js
│   ├── Samples.js
│   └── ProdMixMasters.js
│
├── services/
│   └── b2Service.js           # Backblaze B2 upload with retry
│
└── utils/
    ├── ApiError.js            # Custom error class (6 factory methods)
    └── response.js            # Uniform success response helper
```

---

## Getting Started

### Prerequisites

- Node.js 20
- MongoDB instance (Atlas recommended)
- Backblaze B2 account with a bucket
- Google Cloud Console project with OAuth 2.0 credentials

### Installation

```bash
nvm use
npm install
cp .env.example .env   # fill in your values
npm start               # starts on port 5000
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | | `development` | Environment mode |
| `PORT` | | `5000` | Server port |
| `MONGODB_URI` | ✅ | — | MongoDB connection string |
| `JWT_SECRET` | ✅ | — | Access token sign key (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | — | Refresh token sign key (min 32 chars) |
| `B2_KEY_ID` | ✅ | — | Backblaze B2 app key ID |
| `B2_APPLICATION_KEY` | ✅ | — | Backblaze B2 app key |
| `B2_BUCKET_ID` | ✅ | — | B2 bucket ID |
| `B2_BUCKET_NAME` | ✅ | — | B2 bucket name |
| `B2_PUBLIC_URL` | ✅ | — | B2 public endpoint (CDN URL) |
| `GOOGLE_CLIENT_ID` | ✅ | — | Google OAuth client ID |
| `FRONTEND_URL` | | `http://localhost:3000` | CORS origin |

> **Note:** In production (Render), set these in the Render dashboard. The Zod schema at startup validates all required vars and exits with a diagnostic message if any are missing.

---

## API Reference

### 🔐 Authentication (`/api/auth`)

Rate-limited: **20 requests per 15 minutes**.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/google-login` | — | Exchange Google id_token for JWT pair |
| `GET` | `/api/auth/verify-token` | Bearer | Verify and decode current access token |
| `POST` | `/api/auth/refresh` | Cookie | Issue new access token via httpOnly refresh cookie |
| `POST` | `/api/auth/logout` | — | Clear refresh cookie |

**Token flow:**
```
Google OAuth popup → id_token
  → POST /api/auth/google-login
  → Upsert User in MongoDB
  → Generate access token (15m, JWT_SECRET) + refresh token (7d, JWT_REFRESH_SECRET)
  → Set-Cookie: refreshToken (httpOnly, sameSite:strict, secure)
  → Response: { token, user: { name, email, role, imageUrl } }
```

### 📖 Public Resources (`/api/resources`)

Public read-only endpoints. File URLs are dynamically resolved to B2 CDN paths via `buildPublicUrl()`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/resources/playlists` | All playlists with `beatsCount` aggregation |
| `GET` | `/api/resources/samplePacks` | All sample packs with `samplesCount` aggregation |
| `GET` | `/api/resources/:resourceType` | All items by type (`beats`, `samples`, `loops`, `prodmixmasters`) |
| `GET` | `/api/resources/:resourceType/playlist/:playlistId` | Playlist/samplepack metadata + its items |

### 🔑 Admin CRUD (`/api/admin`)

All routes require `Authorization: Bearer <token>` with **admin role**. Upload routes rate-limited: **10 requests per minute**.

#### Upload

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/upload` | Single file (audio: 100MB, image: 10MB, video: 500MB) |
| `POST` | `/api/admin/upload/batch` | Batch upload up to 20 files (returns per-file results) |

#### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/dashboard` | Aggregate counts for all resource types + users |

#### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users sorted by `createdAt` desc |
| `PUT` | `/api/admin/users/:id/role` | Update role (`user` / `admin`) |

#### Playlists & Sample Packs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/playlists` | List all playlists with item counts (by type) |
| `POST` | `/api/admin/playlists` | Create playlist (title, description, imageUrl, backgroundVideo, type) |
| `PUT` | `/api/admin/playlists/:id` | Update playlist |
| `DELETE` | `/api/admin/playlists/:id` | Delete playlist + cascade-delete all child beats/loops |
| `POST` | `/api/admin/playlists/:id/duplicate` | Deep-copy playlist + all items ("Copia de..." prefix) |
| `GET` | `/api/admin/samplepacks` | List all sample packs |
| `POST` | `/api/admin/samplepacks` | Create sample pack |
| `DELETE` | `/api/admin/samplepacks/:id` | Delete + cascade-delete child samples |

#### Beats, Loops, Samples, ProdMixMasters

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/playlists/:id/beats` | List beats in playlist |
| `POST` | `/api/admin/playlists/:id/beats` | Create single beat |
| `POST` | `/api/admin/playlists/:id/beats/batch` | Bulk create beats (`insertMany`) |
| `PUT` | `/api/admin/beats/:id` | Update beat (title, artist, description, audioFile) |
| `DELETE` | `/api/admin/beats/:id` | Delete beat |

Same pattern applies to `loops` (under playlists), `samples` (under samplepacks), and `prodmixmasters` (standalone).

### ⬇️ Download Proxy

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/download?url=<b2-file-url>` | Proxies file from B2 with `Content-Disposition: attachment` |

Validates URL is `https://` and contains `backblazeb2.com`. Bypasses browser CORS restrictions.

### ❤️ Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ ok: true, db: "connected"\|"disconnected" }` |

---

## Data Models

| Collection | Key Fields | Relations |
|---|---|---|
| `users` | `email` (unique), `name`, `googleId`, `role` (`user`\|`admin`) | — |
| `playlists` | `title`, `description`, `imageUrl`, `backgroundVideo`, `type` (`beats`\|`loops`) | Parent of beats/loops |
| `beats` | `title`, `artist`, `description`, `audioFile`, `playlistId` | Belongs to playlist |
| `loops` | `title`, `description`, `audioFile`, `playlistId` | Belongs to playlist |
| `samplepacks` | `title`, `description`, `imageUrl`, `type` (`samples`) | Parent of samples |
| `samples` | `title`, `description`, `audioFile`, `samplepackId` | Belongs to samplepack |
| `prodmixmasters` | `title`, `description`, `audioFile` | Standalone |

All collections include `timestamps: true`. Audio file paths are validated against `^(https?:\/\/|\/)` regex.

---

## Middleware Pipeline

```
Request
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  1. helmet()              — Security headers                │
│     HSTS (2y, preload), referrer-policy: same-origin,      │
│     CSP disabled intentionally for audio/video embeds       │
├─────────────────────────────────────────────────────────────┤
│  2. compression()         — Gzip response compression       │
├─────────────────────────────────────────────────────────────┤
│  3. generalLimiter        — 100 requests per minute (global)│
├─────────────────────────────────────────────────────────────┤
│  4. cors()                — Dynamic origin validation       │
│     Allowed: FRONTEND_URL + https://niv0web.vercel.app     │
│     Methods: GET, POST, PUT, DELETE, OPTIONS                │
│     Credentials: true (for httpOnly refresh cookie)         │
├─────────────────────────────────────────────────────────────┤
│  5. Route matching                                          │
│     /api/auth  → authLimiter (20/15min)                     │
│     /api/admin → uploadLimiter (10/min)                     │
├─────────────────────────────────────────────────────────────┤
│  6. cookie-parser         — Parse httpOnly refresh cookie   │
├─────────────────────────────────────────────────────────────┤
│  7. body-parser           — JSON + URL-encoded (50MB limit) │
├─────────────────────────────────────────────────────────────┤
│  8. Route handlers         — Auth → Public → Admin → Proxy  │
├─────────────────────────────────────────────────────────────┤
│  9. 404 catch-all         → ApiError.notFound()             │
├─────────────────────────────────────────────────────────────┤
│ 10. errorHandler          → Uniform JSON error response     │
└─────────────────────────────────────────────────────────────┘
```

---

## Error Handling

Every error returns a consistent JSON shape:

```json
{
  "success": false,
  "message": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "errors": [
    { "field": "title", "message": "Title is required" }
  ]
}
```

**HTTP status codes used:**

| Code | Meaning | When |
|---|---|---|
| 400 | Bad Request | Validation errors, malformed JSON, missing params |
| 401 | Unauthorized | Invalid/expired JWT |
| 403 | Forbidden | Not admin, invalid download source |
| 404 | Not Found | Route or resource not found |
| 409 | Conflict | Duplicate key (MongoDB code 11000) |
| 429 | Rate Limited | Too many requests |
| 500 | Internal Server Error | Everything else (logged to console) |

The `errorHandler` middleware catches Mongoose `ValidationError`, `CastError`, duplicate keys, JWT errors, JSON parse errors, and custom `ApiError` instances.

---

## Backblaze B2 Integration

[`services/b2Service.js`](services/b2Service.js) handles file uploads:

- **Singleton authorization** — caches B2 auth token; resets on auth failure
- **File validation** — allowed MIME types + max sizes: audio 100MB, image 10MB, video 500MB
- **Sanitized filenames** — strips special chars, truncates to 100 chars, prepends timestamp + random slug
- **Smart retry** — up to 3 attempts with exponential backoff; handles 401/403/429/ECONNRESET/ETIMEDOUT
- **Batch upload** — `Promise.allSettled` returns per-file success/error results
- **URL resolution** — stored file paths are relative; `buildPublicUrl()` constructs full B2 CDN URL at response time

---

## Deployment

### Docker (Render)

```bash
docker build -t niv0web-api .
docker run -p 5000:5000 niv0web-api
```

The `Dockerfile` uses `node:20-alpine` and `npm ci --production` for deterministic, minimal builds. Render auto-deploys on push to the configured branch.

**Render dashboard required env vars:** all variables listed in the Environment Variables table above.

### Local development

```bash
npm start    # node server.js (with nodemon, add to devDependencies)
npm test     # jest --passWithNoTests
```

---

## License

MIT — built by [Nicolas Quiroga](https://github.com/NicolasQuirogaweb)
