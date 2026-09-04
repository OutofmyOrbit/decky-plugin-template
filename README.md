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
* `mpv` installed on the device running the plugin. If it's missing, the plugin will offer to install it for you
  (via Flatpak/Flathub) the first time you try to play something.

## Features

* Login screen (server URL, username, password, "Remember me") — the API token (and, if remembered, your
  credentials) are stored in the plugin's settings dir so the plugin logs itself back in automatically, even if the
  saved token later goes stale (server restart, password change, etc).
* Browse libraries → items (with search) → item details.
* Play / resume (resumes from your last Audiobookshelf progress), with cover art shown in the mini-player.
* Persistent mini-player in the QAM: cover art, play/pause, ±30s seek, prev/next chapter, chapter dropdown, playback
  speed.
* Periodic progress sync to Audiobookshelf (every 20s and on stop) via the official session sync/close API.
* Automatic `mpv` install prompt (via Flatpak/Flathub) if no `mpv` binary is found on the system.
* Offline downloads: download an item's audio (and cover) to local storage for offline playback; downloaded items
  are played from disk automatically (no re-streaming) and keep syncing progress when a connection is available.

## Known limitations (MVP)

* One active playback session at a time (starting a new item stops the previous one).
* `timeListened` sent to the server is approximated from wall-clock time between syncs while playing, not exact
  decoded audio time.
* No support yet for podcasts/episodes or series browsing — books only.
* Credentials are stored in plaintext in the plugin's settings directory (same trust boundary as the existing
  auth token) to support "remember me" / automatic re-login. This is only readable by the user/root account the
  Decky plugin backend runs as, not exposed to other apps or the network. Uncheck "Remember me" at login if you'd
  rather not persist your password.
* Offline downloads are stored under the plugin's runtime data dir; there's no disk-space/quota management beyond
  manually deleting individual downloads from the item detail screen.

## mpv installation

The plugin looks for mpv in this order:

1. **Bundled binary** — `bin/mpv` inside the plugin folder, if present. Not shipped by default (no official static
   Linux mpv build exists to vendor); this is a personal escape hatch for when the Flatpak sandbox can't reach the
   Deck's audio/display sockets. The easiest way to produce one, since you likely already have the mpv Flatpak
   installed: run [`scripts/extract-flatpak-mpv.sh`](scripts/extract-flatpak-mpv.sh) on the Deck. It pulls the `mpv`
   binary and its shared library dependencies straight out of the already-installed, Flathub-verified `io.mpv.Mpv`
   Flatpak, and wraps them so mpv runs as a normal subprocess — no `flatpak run`/bubblewrap sandbox involved, which
   sidesteps the sandbox environment issues entirely. Copy the resulting `mpv`, `mpv.bin`, `ld.so`, and `lib/` into
   this repo's `bin/` folder; they'll be picked up automatically and included in `npm run build`'s zip.
2. **System `mpv`** — preinstalled on SteamOS in most images.
3. **Flatpak fallback** — if neither of the above is found, the item detail screen shows an "Install mpv (via
   Flatpak)" button, which adds the Flathub remote (if needed) and installs the community-maintained
   [`io.mpv.Mpv`](https://flathub.org/apps/io.mpv.Mpv) Flatpak for the current user — no changes to the read-only
   SteamOS system partition are required. Playback then launches mpv via `flatpak run` with access to the plugin's
   runtime folder (for the IPC socket) instead of a bare `mpv` binary.

## Development

Requires Node.js 18+ and npm (or pnpm) for the frontend, and a Python 3.11+ install for local syntax checks. No pip
packages are required at runtime — the Audiobookshelf HTTP client and downloader use only `urllib`/stdlib, and
playback control shells out to the `mpv` binary (or Flatpak) via its IPC socket.

```bash
npm install
npm run build     # bundles src/ -> dist/index.js, then packages out/<plugin name>.zip
```

`npm run build` produces `out/Audiobookshelf.zip`, containing exactly the files Decky Loader needs
(`plugin.json`, `package.json`, `main.py`, `py_modules/`, `dist/`) nested in a single top-level folder. Copy that zip
to your Deck however is convenient (USB drive, `scp`, browser download, etc.) and either extract it into
`~/homebrew/plugins/Audiobookshelf` or use Decky's "Install Plugin from Zip" option in Developer Settings.

To iterate quickly, `npm run watch` rebuilds on file changes (skips zip packaging — run `npm run build` again when
you want a fresh zip).

### Live Deck deployment

For rapid frontend work on a real Deck, configure SSH key authentication once and run:

```powershell
npm run dev:deck
```

The command starts Rollup watch mode, uploads changed `dist/` output and Python files (`main.py` and `py_modules/`),
and restarts Decky Loader after each successful upload. It asks for the Deck's sudo password once when the watcher
starts. The SSH connection itself must use a key or an `ssh-agent`; OpenSSH cannot reuse a login password through a
script's stdin. Stop the watcher with `Ctrl+C`. Use the optional parameters on `scripts/watch-deploy.ps1` when the
Deck is not at the defaults:

```powershell
./scripts/watch-deploy.ps1 -HostName steamdeck.local -User deck -IdentityFile $env:USERPROFILE\.ssh\id_ed25519
```

The existing `npm run build` and `scripts/deploy-to-deck.ps1` workflow remains the full package deployment path.

### Testing without a Steam Deck

Deploying to a real Deck for every change is slow. Two better options while iterating:

1. **Run Decky Loader on a regular Linux desktop/VM.** Decky Loader isn't Deck-specific — it works on any Linux
   machine with Steam installed (Desktop Mode is just Linux + Steam + KDE). Install Steam and Decky Loader on a
   spare Linux box or a Linux VM, point Steam at Big Picture/Gaming Mode (or just open the QAM in Desktop Mode), and
   deploy the plugin to `~/homebrew/plugins/` on that machine instead of over SSH to the deck — this exercises the
   real frontend, the real Decky RPC bridge, and (if you install `mpv`) real playback, without needing Deck hardware.
2. **Exercise the Python backend directly** with [`dev/local_test.py`](dev/local_test.py), which stubs out the
   `decky` module Decky Loader normally injects and drives `main.Plugin` directly:
   ```bash
   python dev/local_test.py
   ```
   This lets you test login/auto-relogin, library browsing, mpv detection, and downloads against a real
   Audiobookshelf server without any Decky/Steam involvement at all. It won't exercise the frontend or (on Windows)
   real mpv IPC, since mpv's IPC socket is a Unix domain socket that Python's asyncio can't open on Windows — run it
   under WSL2/Linux/macOS with `mpv` installed to test actual playback this way.

### Project layout

* `main.py` — Decky `Plugin` class: config persistence, auto re-login, all frontend-callable methods, download
  orchestration, and the progress-sync loop.
* `py_modules/abs_client.py` — Minimal Audiobookshelf HTTP API client (stdlib only).
* `py_modules/mpv_controller.py` — Spawns and drives headless `mpv` (system binary or Flatpak) over its JSON IPC
  socket; also handles Flatpak-based mpv installation.
* `py_modules/downloader.py` — Background-thread download manager for offline playback.
* `src/api.ts` — Typed `callable()` wrappers around the backend methods.
* `src/components/` — `LoginView`, `LibraryView`, `ItemDetailView`, `PlayerView` (mini-player).
* `src/index.tsx` — Top-level QAM panel: screen routing + persistent player polling.
* `dev/local_test.py` — Local backend test harness (see "Testing without a Steam Deck" above).

## License

BSD-3-Clause (see `LICENSE`).
