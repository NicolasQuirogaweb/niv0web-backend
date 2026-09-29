# CLAUDE.md

Context for AI coding agents working in this repo. Humans: see README.md.

## Commands

- `npm run dev`: API on :5000 with nodemon (needs a real `.env`)
- `npm test`: jest + supertest. No DB or network: models are mocked and env comes from `tests/setupEnv.js`.
- `npm run lint`: ESLint flat config. CI fails on any error.
- `docker build -t niv0web-api .`: CI also builds the image.

Run `npm run lint && npm test` before saying a change is done.

## Architecture in one paragraph

`app.js` builds the Express app and exports it. `server.js` connects to Mongo and then listens. Routes hold the handlers directly: there is no controller layer, keep it that way. Errors are thrown as `ApiError` (`utils/ApiError.js`) inside `asyncHandler` and shaped by `middleware/errorHandler.js`. Success responses always go through `success(res, data)` from `utils/response.js`. Files are uploaded to B2 by `services/b2Service.js`. Documents store the full public URL, and older ones store a relative path that `utils/buildPublicUrl.js` normalizes.

## Conventions

- Error responses: `{ success: false, message, code }`. Never `res.status(x).json({ message })` by hand. Throw `ApiError.badRequest(msg, 'CODE')` and friends.
- User-facing messages are in Spanish (the admin panel is Spanish). Code, comments on public APIs, commits and docs are in English. Short inline comments explaining *why* may be in Spanish, as in the rest of the codebase.
- New request bodies need express-validator rules plus `validate`. PUT routes reuse the POST rules made optional (`asOptional` in `routes/adminRoutes.js`).
- Counting children per parent: use `utils/countByParent.js`, never a `countDocuments` per item.
- Commits: conventional commits (`fix:`, `feat:`, `chore:`, `test:`, `docs:`), imperative, and a body that explains why.

## Security rules (don't regress these)

- `routes/auth.js` must verify Google ID tokens with `verifyIdToken({ audience: GOOGLE_CLIENT_ID })`.
- `/api/download` must only proxy URLs accepted by `utils/downloadSource.js`. If you touch it, extend `tests/downloadSource.test.js`.
- `adminAuth` reads the role from the database, not from the JWT.
- Never log tokens, cookies or full request bodies. Never read or print `.env`.
- `app.set('trust proxy', 1)` is required on Render for rate limiting. Don't remove it.

## Don't

- Don't add a controller/service layer "for cleanliness". The route files are small enough.
- Don't commit audio or media: `beats/`, `samples/`, `loops/`, `prodmixmasters/` and `uploads/` are git-ignored on purpose.
- Don't change response field names (`itemsCount`, `beatPlaylists`, ...) without updating the frontend repo (`niv0web-frontend`, `src/services/api.js`).

## Skills

- `.claude/skills/add-resource-type`: adding a new kind of content end to end.
- `.claude/skills/release-check`: what to verify before merging to `main` (Render deploys from it).
