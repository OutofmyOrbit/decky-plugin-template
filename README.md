# Decky Audiobookshelf

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for Steam Deck (and any SteamOS/Linux desktop
running Decky) that lets you browse your [Audiobookshelf](https://www.audiobookshelf.org/) library and control
playback right from the Quick Access Menu (QAM) — play/pause, skip ±30s, next/previous chapter, jump to a chapter,
and change playback speed.

Audio is played by a headless `mpv` process controlled over its JSON IPC socket, so playback keeps going while you're
in-game or the QAM is closed. Listening progress is synced back to your Audiobookshelf server periodically and when
you stop playback, so it shows up correctly in other Audiobookshelf clients.

## Requirements

* A running Audiobookshelf server you can log into (server URL + username/password).
* `mpv` installed on the device running the plugin. It's preinstalled on SteamOS; if it's missing you'll get a clear
  error when you try to play something.

## Features

* Login screen (server URL, username, password) — the returned API token is stored in the plugin's settings dir.
* Browse libraries → items (with search) → item details.
* Play / resume (resumes from your last Audiobookshelf progress).
* Persistent mini-player in the QAM: play/pause, ±30s seek, prev/next chapter, chapter dropdown, playback speed.
* Periodic progress sync to Audiobookshelf (every 20s and on stop) via the official session sync/close API.

## Known limitations (MVP)

* One active playback session at a time (starting a new item stops the previous one).
* `timeListened` sent to the server is approximated from wall-clock time between syncs while playing, not exact
  decoded audio time.
* No support yet for podcasts/episodes, series browsing, or offline downloads — books only.

## Development

Requires Node.js 18+ and npm (or pnpm) for the frontend, and a Python 3.11+ install for local syntax checks. No pip
packages are required at runtime — the Audiobookshelf HTTP client uses only `urllib` from the standard library, and
playback control shells out to the `mpv` binary via its IPC socket.

```bash
npm install
npm run build     # bundles src/ -> dist/index.js
```

To iterate quickly, `npm run watch` rebuilds on file changes. Deploy the plugin folder (containing `plugin.json`,
`package.json`, `main.py`, `py_modules/`, and `dist/`) into `~/homebrew/plugins/decky-audiobookshelf` on your Deck (or
use Decky CLI's deploy tooling), then reload plugins from the Decky settings menu.

### Project layout

* `main.py` — Decky `Plugin` class: config persistence, all frontend-callable methods, and the progress-sync loop.
* `py_modules/abs_client.py` — Minimal Audiobookshelf HTTP API client (stdlib only).
* `py_modules/mpv_controller.py` — Spawns and drives headless `mpv` over its JSON IPC socket.
* `src/api.ts` — Typed `callable()` wrappers around the backend methods.
* `src/components/` — `LoginView`, `LibraryView`, `ItemDetailView`, `PlayerView` (mini-player).
* `src/index.tsx` — Top-level QAM panel: screen routing + persistent player polling.

## License

BSD-3-Clause (see `LICENSE`).
