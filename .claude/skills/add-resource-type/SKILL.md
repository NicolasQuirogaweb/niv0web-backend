---
name: add-resource-type
description: Add a new kind of catalog content (like beats, loops or samples) to the niv0web API end to end — model, public and admin routes, validation, tests and docs. Use when asked to support a new content type or collection.
---

# Adding a resource type

The existing types are the template: `Loops` (belongs to a `Playlist` of type `loops`) and `Samples` (belongs to a `SamplePack`). Copy the closest one instead of inventing a new shape.

## Steps

1. **Model** in `models/`. Required `title` (max 100), optional `description` (max 300), `audioFile` with the same URL validator as `models/Beat.js`, a parent id with a correct `ref`, `{ timestamps: true }`, and an index on `{ parentId: 1, createdAt: -1 }`.
2. **Parent type.** If it hangs from `Playlist`, add the value to the `type` enum in `models/Playlist.js`, to the `?type=` filter in `routes/resourceRoutes.js`, and to the counts in `GET /playlists` (admin and public).
3. **Public routes.** Add an entry to `RESOURCE_MAP` in `routes/resourceRoutes.js`. `responseKey` is the key the frontend reads, so keep it equal to the URL segment.
4. **Admin routes** in `routes/adminRoutes.js`: list, create (with `requirePlaylistOfType` or an equivalent parent check), batch, PUT with `trackUpdateFields`, DELETE. Add the folder to `UPLOAD_FOLDERS` if files go to a new B2 prefix.
5. **Dashboard.** Add a count in `GET /dashboard`.
6. **Tests** in `tests/api.test.js`: at minimum, creating in the wrong parent type returns 400 `WRONG_PLAYLIST_TYPE` and an empty title on PUT returns 400.
7. **Docs.** Update the API section of `README.md`. If it changes a response shape, note it in `CHANGELOG.md` under Unreleased.
8. **Frontend.** The frontend repo needs a service in `src/services/api.js` and, for playlists, an entry in `playlistServices`. Say so in the summary: this repo can't do it.

Finish with `npm run lint && npm test`.
