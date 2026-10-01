---
name: release-check
description: Checklist to run before merging into main on niv0web-backend (Render auto-deploys main). Use when asked to prepare a release, open a PR to main, or check whether the branch is ready to ship.
---

# Release check

Render deploys `main` automatically, so a bad merge goes straight to production.

1. `npm run lint && npm test`. Both must pass.
2. `git diff main...HEAD --stat` and read the diff. Look for leftover `console.log`, commented-out code, and secrets.
3. **Env drift.** Every variable in `config/env.js` must appear in `.env.example` and in the README table. A newly *required* variable also has to be added in the Render dashboard before merging, or the deploy will crash on boot. Tell the user.
4. **Contract drift.** If any response field or route changed, check that `niv0web-frontend/src/services/api.js` and its callers still match. Say which frontend change has to ship first.
5. **Docs.** README claims (limits, endpoints, cookie settings) still match the code. Move the Unreleased items in `CHANGELOG.md` under a dated version.
6. Summarize what changed for the user in 3-5 lines, plus anything they have to do by hand (Render env vars, rotating a secret). Don't merge or push yourself.
