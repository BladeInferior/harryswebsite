# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal static website (`bladeinferior.github.io` / served from `/` on a custom domain — `index.html` picks the base path at runtime by checking `window.location.hostname`) with no build step, no bundler, and no framework. Every page is plain HTML with `<script>` tags (some `type="module"`, most not). There is no lint or test suite — `package.json` only lists `axios`/`node-fetch`, used by a handful of one-off Node scripts (see "Asset-download scripts" below), not by the site itself.

## Commands

- **Run the site locally**: just open the HTML files directly, or serve the repo root with any static file server (e.g. `npx serve .`) — there is nothing to build or compile first.
- **Run a one-off asset-download script** (from `collection-hub/`, where their `node_modules` lives): `node download-missing-pokeballs.js`, `node download-missing-trainers.js`, `node download-type-icons.js`. These are idempotent (they skip files that already exist locally) and only ever add new files under `collection-hub/`.
- No test runner, linter, or build command exists in this repo.

## Site structure

Top-level "hubs", each self-contained with its own `.html` pages, nav script, and (mostly) CSS:

- `collection-hub/` — Pokémon dex tracking, TCG cards, sleeves, pop figures, steelbooks, pins, game-completion tracking, milestones. By far the largest and most actively developed area.
- `quizhub/` — a live multi-player quiz builder/host/play system (`builder/`, `host-quiz/`, `join/`, `play-test/`, `engine/` for answer matching, `manage-quizzes/`, `review/`, `stats/`). `quiz-app-feature-spec.md` at the repo root is a standing backlog of specced-but-not-yet-built features for this hub — check it before assuming a described quiz feature exists.
- `movie-hub/` — a Letterboxd-watchlist picker wheel.
- `adminhub/` — owner-only tools, currently a Firestore-backed notes app (`notes.html`/`notes.js`).
- `homepage/` — assets for the root `index.html` landing page.

Root-level shared files used across multiple hubs: `firebase-config.js`, `admin-auth-core.js`, `admin-auth.js`, `navbar.html`/`navbar.css`, `scroll-to-top.js`, `sw-nocache.js`.

## Firebase: one shared app instance

`firebase-config.js` at the repo root is the **only** place that calls `initializeApp()` — it exports `db` (Firestore), `auth`, `googleProvider`, and `storage`. Every other `firebase-config.js` in the repo (`adminhub/firebase/firebase-config.js`, `quizhub/firebase/firebase-config.js`) is a thin `export * from '.../firebase-config.js'` re-export shim, not a second Firebase app — calling `initializeApp()` again with the same config throws, since `admin-auth.js` is loaded site-wide and would otherwise collide with a page's own second init. When adding a new Firebase-backed feature, import from the root config (directly or via the nearest shim) rather than initializing a new app.

## Admin auth (three layers, one identity)

- `admin-auth-core.js` — pure state/API (sign-in, `isSignedInAsAdmin()`, `onAdminStateChange()`), no DOM. Safe to import anywhere. `OWNER_EMAIL` is the single gate: only that Google account is ever treated as admin.
- `admin-auth.js` — wraps the core module and self-mounts the generic bottom-right sign-in widget site-wide.
- `adminhub/auth.js` (`requireAdminAuth()`) — a heavier full-page lockout gate + session pill, built on the same core module, used by pages under `adminhub/` (and conceptually by anything needing a hard "this whole page is admin-only" wall rather than just a corner widget).

All three resolve to the same signed-in identity, so signing in via one satisfies the others in the same browser. **Client-side gating is not real enforcement** — the actual security boundary is the Firestore/Storage rules requiring `request.auth.token.email == OWNER_EMAIL`, which live in the Firebase console, not in this repo. Adding a new admin-only Firestore collection or Storage path means updating those rules out-of-band.

## Collection Hub data model: localStorage + static JSON + Cloudflare export

Each collection type (pokedex, cards, sleeves, etc.) ships a static `*-backup.json` file in `collection-hub/`. On load, the page reads that JSON, then merges any `localStorage` edits on top of it as the live in-memory state — `localStorage` is the actual write buffer during editing, not the JSON file. The "Export" button (see `collections.js`, `pokedexes.js`) POSTs the current state to a Cloudflare Worker (`orange-bar-b027.harrycummins.workers.dev/export`), authenticated with the admin's Firebase ID token, which is what actually commits the updated JSON back to the GitHub repo. `unsaved-changes.js` tracks a dirty flag per dataset by diffing the current serialized state against the snapshot taken right after the localStorage merge (not against the raw fetched JSON), so edits from a prior unexported session aren't flagged as new changes on load.

## Pokédex filters (`collection-hub/pokedexes/pokedexes.js`)

All filter UI is built dynamically into an empty `#game-filter-container` div by `createFilterButtons()` — there's no static filter markup in `pokedexes.html` to edit. `applyFilters()` computes each filter as an independent `matchesX` boolean (search, game, generation, tags, missing/completion, type, etc.) and ANDs them together at the end; adding a new filter means adding both a UI section in `createFilterButtons()` and a `matchesX` const in `applyFilters()`, plus wiring its reset into the Reset Filters handler and `clearNonTodoFilters()`. Pokémon type data comes from `fullPokemonList.json`'s `type` field, a comma-separated string (e.g. `"Grass, Poison"`), parsed and lowercased at filter time — it is not pre-normalized in the JSON itself.

## Shiny Hunts archive (`collection-hub/pokedexes/pokedexes.js`, Shiny Dex only)

A second, independent data domain living on the same page as the main per-Pokémon grid: `shinyHunts` is a flat array of `{ id, name, encounters }` records (own localStorage key `"shinyHunts"`, own backup file `collection-hub/shiny-hunts-backup.json`, own unsaved-changes tracker), not part of `savedDexData`. The "Hunts" button in `#page-controls` only appears while `activeDexEdit === "shinyDex"`; toggling it (`huntsModeActive`) swaps the whole per-Pokémon browsing UI out for `#hunts-container`'s own card grid (see the hunts-mode branch in `updateModeUI()`) rather than filtering on top of it the way To Do does. Add/Edit/Delete follow completions.html's Milestones tab pattern exactly (`.add-item-box` form modal + `.modal-left`/`.modal-right`/`.item-actions` view modal), reusing those global CSS classes. The single Export button commits **both** files in one click via a shared `exportJsonFile()` helper — any new per-page data domain that needs GitHub-backed persistence should follow this same "own tracker key, own backup JSON, exported alongside the rest" shape rather than being folded into `savedDexData`.

## Notes app (`adminhub/notes.js`)

Firestore collection `notes`, one doc per note (`title`, `content`, timestamps). `content` is a single newline-joined string, not structured JSON — each line encodes its own type via a bracket prefix: plain text is the raw line, checkboxes are `"[ ] text"` / `"[x] text"`, images are `"[img] <url>"`. The DOM mirrors this as one `.note-line` element per line inside `#note-content-input`; `serializeContent()`/`deserializeContent()` are the two directions of that encoding. Images upload to Firebase Storage under `notes/{noteId}/...` and only the resulting download URL is stored in the content string.

## Stream Counter (`adminhub/counter.html`/`counter.js` + `adminhub/stream-counter-server/`)

The one admin-hub feature that needs write access outside the repo, so unlike everything else here it can't run as a static page — `adminhub/stream-counter-server/server.js` is a standalone local Node/Express server (own `package.json`/`node_modules`, following the same "commit node_modules" convention as `collection-hub`'s asset-download scripts) that must be started manually (`node adminhub/stream-counter-server/server.js`) before the page is useful. It double-duties as the static file server for the *entire* site (`express.static` on the repo root) so `adminhub/counter.html`'s `fetch('/api/generate-counter')` calls stay same-origin — opening the page via GitHub Pages or any other static server instead means the buttons will fail with a fetch/network error, since only this server has the API route. `POST /api/generate-counter` drives Textcraft's real Pokémon-style generator (`gentext3.php`, with every style param hardcoded from a captured working request — only `text` ever changes) rather than recreating that look, downloads the resulting PNG, and atomically replaces `D:\Libraries\Desktop\leisure\streaming\currentNum.png` (write to `.tmp.png`, then rename) so OBS never reads a half-written file. The counter's current/total values live in the browser's `localStorage` only — the server is stateless per-request.

## Mobile pop-out pattern (`collection-hub/mobile-popout.js`)

`createMobilePopout()` doesn't build a separate mobile UI — it *relocates* the real, already-wired desktop controls (e.g. the whole `#game-filter-container`) into a floating panel below a toggle button on narrow screens, moving them back to their original DOM position above the mobile breakpoint. Returns a `sync()` function that must be re-called if the tracked container gets rebuilt (e.g. `createFilterButtons()` re-running). Only one panel can be open at a time across the page.

## Service workers

Two independent service workers with non-overlapping concerns, resolved by scope specificity (the more specific scope always wins): `collection-hub/sw.js` (registered from `collection-nav.js`, scope `collection-hub/`) precaches an offline app shell for that hub specifically; root `sw-nocache.js` (registered from `index.html`, `quiz-nav.js`, `admin-nav.js`, scope `/`) does no caching at all — it just forces every other page to always re-fetch from the network instead of trusting the browser's HTTP cache, so deploys show up without a hard refresh.

## Asset-download scripts

One-off Node scripts under `collection-hub/` (`download-missing-pokeballs.js`, `download-missing-trainers.js`, `download-type-icons.js`) pull sprite/icon images from the PokeAPI sprites GitHub raw CDN (`raw.githubusercontent.com/PokeAPI/sprites/...`) into local folders (`cards/pokeballs/`, `icons/types/`, etc.). They're run manually, never part of any automated build, and are all written to skip files that already exist so they're safe to re-run.
