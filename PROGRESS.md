# Handoff Notes — Decky Audiobookshelf Plugin

This file exists to give a fresh Copilot Chat session (or any future contributor) full context on this
project without needing the original conversation history. It was written after the initial MVP build.

## What this project is

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for Steam Deck / SteamOS that:
- Logs into an [Audiobookshelf](https://www.audiobookshelf.org/) server
- Lets you browse libraries and library items (search included)
- Plays audiobooks via a headless `mpv` process, controlled over mpv's JSON IPC socket
- Exposes basic transport controls (play/pause, ±30s seek, prev/next chapter, chapter jump, playback speed)
  right in the Steam Quick Access Menu (QAM)
- Periodically syncs listening progress back to the Audiobookshelf server (so progress shows correctly in
  other ABS clients)

## Current status: MVP built, NOT yet runtime-tested

Everything below was written and validated for **syntax/type correctness only**:
- Python files pass `python -m py_compile` (Python 3.12, on Windows — no `mpv`/Linux available to
  actually test playback).
- TypeScript/React frontend builds cleanly via `npm run build` (rollup + `@decky/rollup`), producing
  `dist/index.js`.

**Nothing has been tested against a real Audiobookshelf server, real mpv process, or inside Decky Loader
on an actual Steam Deck.** That's the most important next step — see "Next steps" below.

## Repo layout

```
main.py                     Decky Plugin class: config persistence, all frontend-callable RPC methods,
                             progress-sync loop (runs every 20s while playing)
py_modules/
  abs_client.py             Audiobookshelf HTTP API client. stdlib-only (urllib), no pip deps needed.
  mpv_controller.py          Spawns headless `mpv --idle --input-ipc-server=<socket>` and drives it via
                             JSON IPC commands (get_property/set_property/seek/playlist-play-index/quit).
                             Handles multi-track books (one mpv playlist entry per audio file) and maps
                             a "global" audiobook-wide time position to (track index, local offset).
src/
  api.ts                    Typed `callable()` wrappers around every backend RPC method — this is the
                             single source of truth for the frontend<->backend contract.
  index.tsx                 Top-level QAM panel. Screen state machine: loading -> login -> libraries ->
                             item detail. Polls get_player_state() every 1.5s to keep the mini-player in
                             sync while the QAM panel is open.
  components/
    LoginView.tsx            Server URL + username + password form -> calls login()
    LibraryView.tsx           Library picker -> item list (with search) -> onSelectItem callback
    ItemDetailView.tsx        Shows title/author/duration/chapter count, Play/Resume button
    PlayerView.tsx            Persistent "Now Playing" mini-player: progress bar, seek ±30s, play/pause,
                               prev/next chapter, chapter dropdown, speed dropdown, stop
plugin.json                  Decky metadata (name, author, flags, publish info)
package.json                 npm metadata + devDependencies (@decky/rollup, @decky/ui, rollup, typescript)
README.md                    User-facing docs: features, requirements, known limitations, dev instructions
```

Removed from the original `decky-plugin-template` scaffold (not needed for this Python-backend-only
plugin): `backend/` (C++ backend build scaffolding), `defaults/`, `pnpm-lock.yaml` (using npm instead).

## Backend RPC methods (main.py, called via `callable()` from src/api.ts)

Auth/config: `get_config`, `login(server_url, username, password)`, `logout`, `check_connection`
Library browsing: `get_libraries`, `get_library_items(library_id, search)`, `get_item_details(item_id)`
Playback: `play_item(item_id)`, `toggle_pause`, `stop_playback`, `seek_relative(seconds)`,
`seek_to(seconds)`, `next_chapter`, `prev_chapter`, `set_chapter(chapter_id)`,
`set_playback_speed(speed)`, `get_player_state`

All return `{"success": bool, "error"?: str, ...}` shapes (see `BasicResult` / specific result types in
`src/api.ts`).

## Audiobookshelf API endpoints used (see https://api.audiobookshelf.org/)

- `POST /login` — returns `user.token`
- `GET /api/me` — connection check
- `GET /api/libraries` — list libraries
- `GET /api/libraries/{id}/items` and `GET /api/libraries/{id}/search` — browse/search
- `GET /api/items/{id}?expanded=1&include=progress` — item details + chapters + user progress
- `GET /api/items/{id}/cover?token=...` — cover art (used directly as an `<img>`-style URL, token in query)
- `POST /api/items/{id}/play` — starts a playback session, returns `audioTracks`, `chapters`, `currentTime`
- `POST /api/session/{id}/sync` and `POST /api/session/{id}/close` — progress reporting
  (`currentTime` = absolute position, `timeListened` = **delta** since last sync/close, not a total)

## Known limitations / deliberately deferred (MVP scope)

1. **Single active session only** — starting a new item stops/closes whatever was playing.
2. **Podcasts/episodes not supported** — only `mediaType: "book"` library items. `abs_client.py`'s
   `start_playback_session` has an `episode_id` param already plumbed through for future podcast support.
3. **No series browsing** — only flat library item lists + search, no series grouping/collapsing.
4. **`timeListened` is approximated** from wall-clock time elapsed between syncs while `mpv` reports
   `playing: true`, not actual decoded-audio time. Should be accurate enough in practice but is not exact.
5. **No offline downloads/caching** — mpv streams directly from the ABS server over HTTP(S) using a
   token query param, so no internet/LAN connection = no playback.
6. No automated tests exist (none existed to extend; per project conventions, only add tests if it
   becomes appropriate to introduce a real test harness).

## Next steps (priority order)

1. **Get it running on an actual Steam Deck / Linux box with Decky Loader installed and mpv present.**
   - Copy the plugin folder into `~/homebrew/plugins/decky-audiobookshelf/` (see README "Development"
     section for the exact file layout Decky expects: `plugin.json`, `package.json`, `main.py`,
     `py_modules/`, `dist/index.js`).
   - Watch `~/homebrew/logs/decky-audiobookshelf/plugin.log` for backend errors.
   - **If `~/homebrew/plugins` isn't writable via SFTP/GUI paste**, that folder is often root-owned since
     Decky runs plugins as root. Either `sudo unzip`/`sudo cp` into place then `sudo chown -R deck:deck
     ~/homebrew/plugins/decky-audiobookshelf`, or `chown` the whole plugins dir first. This came up
     during initial deployment — see conversation history if picking this back up mid-troubleshooting.
2. **Test login** against a real Audiobookshelf server (verify token is saved/persisted correctly in
   `DECKY_PLUGIN_SETTINGS_DIR/config.json`, verify `check_connection` after a restart).
3. **Test playback end-to-end**: single-file book, multi-file book (verify track-boundary seeking via
   `_locate`/`_global_time` in `mpv_controller.py` works correctly), and a book with real chapter markers.
4. **Verify progress sync** actually lands correctly in Audiobookshelf's UI (check "Continue Listening"
   shelf reflects the position after stopping playback).
5. **Verify mpv IPC socket path** — currently `os.path.join(DECKY_PLUGIN_RUNTIME_DIR, f"mpv-ipc-{pid}.sock")`.
   Confirm `DECKY_PLUGIN_RUNTIME_DIR` exists and is writable at runtime under Decky's execution model
   (plugin backends run as root per `decky.pyi` docs — should be fine, but unverified).
6. Once basics work, consider tackling the "Known limitations" above in priority order the user cares
   about (podcasts and series browsing are likely the most requested).

## Build/dev commands (already verified working)

```bash
npm install       # installs @decky/rollup, @decky/ui, react-icons, typescript, etc.
npm run build     # rollup -c -> dist/index.js (verified clean, no errors/warnings as of last build)
npm run watch     # rollup -c -w, for iterative frontend dev
```

Python has no build step; `python -m py_compile main.py py_modules/*.py` is a quick sanity check but
does not catch logic errors, only syntax errors.

## Packaging note

A distributable zip was created for manual install (see conversation history / user's Downloads) with
this layout at its root:
```
decky-audiobookshelf/
  dist/index.js
  py_modules/{abs_client.py, mpv_controller.py}
  main.py
  plugin.json
  package.json
  README.md
  LICENSE
```
`dist/index.js.map` and `__pycache__/` were deliberately excluded from the distributable zip.
