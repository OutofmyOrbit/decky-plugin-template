import os
import json
import time
import asyncio
import base64

import decky

from abs_client import ABSClient, ABSError
from mpv_controller import MPVController, MPVError
from downloader import Downloader

SYNC_INTERVAL_SECONDS = 20


def _config_path() -> str:
    return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "config.json")


class Plugin:
    async def _main(self):
        self.loop = asyncio.get_event_loop()
        self.client = ABSClient()
        self.mpv = MPVController(decky.logger, decky.DECKY_PLUGIN_RUNTIME_DIR, decky.DECKY_PLUGIN_DIR)
        self.downloader = Downloader(
            decky.logger, os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "downloads")
        )

        self.session_id: str | None = None
        self.now_playing: dict | None = None
        self._last_sync_wall: float = 0.0
        self._last_synced_time: float = 0.0
        self._sync_task: asyncio.Task | None = None

        self._load_config()
        await self._auto_login()
        decky.logger.info("Audiobookshelf plugin started")

    async def _unload(self):
        await self._stop_sync_loop()
        try:
            await self._close_session_if_any()
        except Exception as e:
            decky.logger.warning(f"Error closing session on unload: {e}")
        await self.mpv.stop()
        decky.logger.info("Audiobookshelf plugin unloaded")

    async def _uninstall(self):
        decky.logger.info("Audiobookshelf plugin uninstalled")

    # ------------------------------------------------------------- config

    def _load_config(self):
        path = _config_path()
        cfg = {}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
            except Exception as e:
                decky.logger.warning(f"Failed to read config: {e}")
        self.client.set_server_url(cfg.get("server_url", ""))
        self.client.set_token(cfg.get("token", ""))
        self._username = cfg.get("username", "")
        # Stored only when the user opts in ("remember me") so that a saved token going
        # stale (e.g. server restart, password change) can be silently refreshed.
        self._password = cfg.get("password", "")

    def _save_config(self):
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump({
                "server_url": self.client.server_url,
                "token": self.client.token,
                "username": getattr(self, "_username", ""),
                "password": getattr(self, "_password", ""),
            }, f)

    async def _auto_login(self):
        """Called on plugin start: validate any saved token, and if it's gone stale,
        transparently re-authenticate using saved credentials (if remembered)."""
        if self.client.configured:
            try:
                await self.loop.run_in_executor(None, self.client.get_me)
                return
            except Exception as e:
                decky.logger.info(f"Saved session is no longer valid ({e}); will try saved credentials")
        if self.client.server_url and self._username and self._password:
            try:
                result = await self.loop.run_in_executor(
                    None, self.client.login, self._username, self._password
                )
                token = result.get("user", {}).get("token")
                if token:
                    self.client.set_token(token)
                    self._save_config()
                    decky.logger.info("Automatically re-authenticated using saved credentials")
            except Exception as e:
                decky.logger.warning(f"Automatic re-login failed: {e}")

    # ------------------------------------------------------------- auth api

    async def get_config(self) -> dict:
        return {
            "configured": self.client.configured,
            "server_url": self.client.server_url,
            "username": getattr(self, "_username", ""),
            "hasSavedCredentials": bool(self._username and self._password),
        }

    async def login(self, server_url: str, username: str, password: str, remember: bool = True) -> dict:
        server_url = (server_url or "").strip().rstrip("/")
        if not server_url.startswith("http://") and not server_url.startswith("https://"):
            server_url = "http://" + server_url
        try:
            self.client.set_server_url(server_url)
            result = await self.loop.run_in_executor(
                None, self.client.login, username, password
            )
            user = result.get("user", {})
            token = user.get("token")
            if not token:
                return {"success": False, "error": "No token returned by server"}
            self.client.set_token(token)
            self._username = user.get("username", username)
            self._password = password if remember else ""
            self._save_config()
            return {"success": True, "username": self._username}
        except ABSError as e:
            decky.logger.warning(f"Login failed: {e}")
            return {"success": False, "error": str(e)}
        except Exception as e:
            decky.logger.error(f"Login error: {e}")
            return {"success": False, "error": str(e)}

    async def logout(self) -> dict:
        await self._stop_sync_loop()
        try:
            await self._close_session_if_any()
        except Exception:
            pass
        await self.mpv.stop()
        self.client.set_token("")
        self._username = ""
        self._password = ""
        self._save_config()
        return {"success": True}

    async def check_connection(self) -> dict:
        try:
            me = await self.loop.run_in_executor(None, self.client.get_me)
            return {"success": True, "username": me.get("username")}
        except ABSError as e:
            # Token may have gone stale (server restart, password change, etc) - try
            # a silent re-login with saved credentials before reporting failure.
            if self._username and self._password:
                try:
                    result = await self.loop.run_in_executor(
                        None, self.client.login, self._username, self._password
                    )
                    token = result.get("user", {}).get("token")
                    if token:
                        self.client.set_token(token)
                        self._save_config()
                        return {"success": True, "username": self._username}
                except Exception:
                    pass
            return {"success": False, "error": str(e)}
        except Exception as e:
            return {"success": False, "error": str(e)}


    # ------------------------------------------------------------- library api

    async def get_libraries(self) -> dict:
        try:
            libs = await self.loop.run_in_executor(None, self.client.get_libraries)
            return {
                "success": True,
                "libraries": [{"id": l["id"], "name": l["name"]} for l in libs],
            }
        except ABSError as e:
            return {"success": False, "error": str(e), "libraries": []}
        except Exception as e:
            return {"success": False, "error": str(e), "libraries": []}

    async def get_library_items(self, library_id: str, search: str = "") -> dict:
        try:
            data = await self.loop.run_in_executor(
                None, self.client.get_library_items, library_id, (search or None), 500
            )
            items = []
            for it in data.get("results", []):
                media = it.get("media", {}) or {}
                meta = media.get("metadata", {}) or {}
                progress = it.get("userMediaProgress") or {}
                series_data = meta.get("series") or []
                series_name = ""
                if isinstance(series_data, list) and series_data:
                    series_name = series_data[0].get("name") or ""
                elif isinstance(series_data, str):
                    series_name = series_data
                if not series_name:
                    series_name = meta.get("seriesName") or ""
                items.append({
                    "id": it.get("id"),
                    "title": meta.get("title") or "Unknown title",
                    "author": meta.get("authorName") or meta.get("author") or "",
                    "duration": media.get("duration", 0),
                    "progress": progress.get("progress", 0),
                    "isFinished": progress.get("isFinished", False),
                    "currentTime": progress.get("currentTime", 0),
                    "coverUrl": self.client.cover_url(it.get("id")),
                    "offline": self.downloader.is_downloaded(it.get("id")),
                    "series": series_name,
                    "lastPlayed": progress.get("lastUpdate", 0) or 0,
                })
            if not search:
                items.sort(key=lambda item: (
                    0 if item["lastPlayed"] else 1 if item["offline"] else 2,
                    -float(item["lastPlayed"]) if item["lastPlayed"] else 0,
                    item["title"].casefold(),
                ))
            return {"success": True, "items": items}
        except ABSError as e:
            return {"success": False, "error": str(e), "items": []}
        except Exception as e:
            return {"success": False, "error": str(e), "items": []}

    async def get_item_details(self, item_id: str) -> dict:
        try:
            item = await self.loop.run_in_executor(None, self.client.get_item, item_id)
            media = item.get("media", {}) or {}
            meta = media.get("metadata", {}) or {}
            progress = item.get("userMediaProgress") or {}
            chapters = media.get("chapters", []) or []
            return {
                "success": True,
                "id": item.get("id"),
                "title": meta.get("title") or "Unknown title",
                "author": meta.get("authorName") or meta.get("author") or "",
                "duration": media.get("duration", 0),
                "currentTime": progress.get("currentTime", 0),
                "coverUrl": self.client.cover_url(item_id),
                "chapters": [
                    {"id": c.get("id"), "title": c.get("title"), "start": c.get("start"), "end": c.get("end")}
                    for c in chapters
                ],
                "downloadStatus": self.downloader.get_status(item_id),
            }
        except ABSError as e:
            # Offline fallback: still show basic details for a downloaded item.
            local_meta = self.downloader.get_meta(item_id)
            if local_meta:
                return {
                    "success": True,
                    "id": item_id,
                    "title": local_meta.get("title") or "Unknown title",
                    "author": local_meta.get("author") or "",
                    "duration": sum(t.get("duration", 0) for t in local_meta.get("tracks", [])),
                    "currentTime": 0,
                    "coverUrl": self.client.cover_url(item_id) if self.client.configured else "",
                    "chapters": local_meta.get("chapters", []),
                    "downloadStatus": self.downloader.get_status(item_id),
                }
            return {"success": False, "error": str(e)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_cover(self, item_id: str) -> dict:
        try:
            local_path = self.downloader.local_cover_path(item_id)
            if local_path:
                with open(local_path, "rb") as f:
                    image = f.read(2 * 1024 * 1024 + 1)
                if len(image) > 2 * 1024 * 1024:
                    return {"success": False, "error": "Cover image is larger than 2 MiB"}
                return {"success": True, "dataUrl": "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")}
            data_url = await self.loop.run_in_executor(None, self.client.cover_data_url, item_id)
            return {"success": True, "dataUrl": data_url}
        except ABSError as e:
            return {"success": False, "error": str(e)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------- downloads api

    async def get_download_status(self, item_id: str) -> dict:
        return self.downloader.get_status(item_id)

    async def list_downloads(self) -> dict:
        return {"success": True, "items": self.downloader.list_downloaded()}

    async def download_item(self, item_id: str) -> dict:
        try:
            item = await self.loop.run_in_executor(None, self.client.get_item, item_id)
        except ABSError as e:
            return {"success": False, "error": str(e)}
        media = item.get("media", {}) or {}
        meta = media.get("metadata", {}) or {}
        tracks_raw = media.get("tracks", []) or []
        if not tracks_raw:
            return {"success": False, "error": "This item has no downloadable audio tracks"}
        tracks = [{
            "url": self.client.media_url(t["contentUrl"]),
            "startOffset": t.get("startOffset", 0),
            "duration": t.get("duration", 0),
        } for t in sorted(tracks_raw, key=lambda t: t.get("index", 0))]
        chapters = [
            {"id": c.get("id"), "title": c.get("title"), "start": c.get("start"), "end": c.get("end")}
            for c in media.get("chapters", []) or []
        ]
        title = meta.get("title") or "Unknown title"
        author = meta.get("authorName") or meta.get("author") or ""
        cover_url = self.client.cover_url(item_id)
        self.downloader.start_download(item_id, title, author, cover_url, tracks, chapters)
        return {"success": True}

    async def cancel_download(self, item_id: str) -> dict:
        self.downloader.cancel_download(item_id)
        return {"success": True}

    async def delete_download(self, item_id: str) -> dict:
        self.downloader.delete(item_id)
        return {"success": True}

    # ------------------------------------------------------------- mpv api

    async def get_mpv_status(self) -> dict:
        return {"available": self.mpv.mpv_available()}

    async def install_mpv(self) -> dict:
        ok, error = await self.loop.run_in_executor(None, MPVController.install_mpv_flatpak)
        return {"success": ok, "error": error or None}

    # ------------------------------------------------------------- playback api

    async def play_item(self, item_id: str) -> dict:
        if not self.mpv.mpv_available():
            return {"success": False, "error": 'mpv is not installed. Use the "Install mpv" button below, then try again.'}
        try:
            await self._stop_sync_loop()
            try:
                await self._close_session_if_any()
            except Exception:
                pass

            # Prefer an already-downloaded copy so we don't re-stream, and so playback
            # keeps working even with no connection to the server.
            local_tracks = self.downloader.local_tracks(item_id)
            local_meta = self.downloader.get_meta(item_id) if local_tracks else None

            session_id = None
            if local_tracks:
                tracks = local_tracks
                chapters = local_meta.get("chapters", []) or []
                title = local_meta.get("title") or "Unknown title"
                author = local_meta.get("author") or ""
                cover_url = self.client.cover_url(item_id) if self.client.configured else ""
                start_time = 0
                # Best-effort: still start a real session (for resume position + progress
                # sync) if the server is reachable, but don't fail offline playback if not.
                if self.client.configured:
                    try:
                        session = await self.loop.run_in_executor(
                            None, self.client.start_playback_session, item_id, None
                        )
                        session_id = session.get("id")
                        start_time = session.get("currentTime", 0) or 0
                    except Exception as e:
                        decky.logger.info(f"Playing downloaded copy without a live session: {e}")
            else:
                session = await self.loop.run_in_executor(
                    None, self.client.start_playback_session, item_id, None
                )
                audio_tracks = session.get("audioTracks", []) or []
                if not audio_tracks:
                    return {"success": False, "error": "This item has no playable audio tracks"}

                tracks = [{
                    "url": self.client.media_url(t["contentUrl"]),
                    "startOffset": t.get("startOffset", 0),
                    "duration": t.get("duration", 0),
                } for t in sorted(audio_tracks, key=lambda t: t.get("index", 0))]

                chapters = [
                    {"id": c.get("id"), "title": c.get("title"), "start": c.get("start"), "end": c.get("end")}
                    for c in session.get("chapters", []) or []
                ]
                title = session.get("displayTitle") or "Unknown title"
                author = session.get("displayAuthor") or ""
                cover_url = self.client.cover_url(item_id)
                start_time = session.get("currentTime", 0) or 0
                session_id = session.get("id")

            await self.mpv.start(tracks, chapters, start_time)

            self.session_id = session_id
            self.now_playing = {
                "itemId": item_id,
                "title": title,
                "author": author,
                "coverUrl": cover_url,
                "offline": local_tracks is not None,
            }
            self._last_sync_wall = time.monotonic()
            self._last_synced_time = start_time
            if self.session_id:
                self._start_sync_loop()
            return {"success": True}
        except (ABSError, MPVError) as e:
            decky.logger.warning(f"play_item failed: {e}")
            return {"success": False, "error": str(e)}
        except Exception as e:
            decky.logger.error(f"play_item error: {e}")
            return {"success": False, "error": str(e)}

    async def toggle_pause(self) -> dict:
        try:
            await self.mpv.toggle_pause()
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def stop_playback(self) -> dict:
        await self._stop_sync_loop()
        try:
            await self._close_session_if_any()
        except Exception as e:
            decky.logger.warning(f"Error closing session: {e}")
        await self.mpv.stop()
        self.now_playing = None
        self.session_id = None
        return {"success": True}

    async def seek_relative(self, seconds: float) -> dict:
        try:
            await self.mpv.seek_relative(seconds)
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def seek_to(self, seconds: float) -> dict:
        try:
            await self.mpv.seek_to(seconds)
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def next_chapter(self) -> dict:
        try:
            await self.mpv.next_chapter()
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def prev_chapter(self) -> dict:
        try:
            await self.mpv.prev_chapter()
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def set_chapter(self, chapter_id) -> dict:
        try:
            await self.mpv.set_chapter(chapter_id)
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def set_playback_speed(self, speed: float) -> dict:
        try:
            await self.mpv.set_speed(speed)
            return {"success": True}
        except MPVError as e:
            return {"success": False, "error": str(e)}

    async def get_player_state(self) -> dict:
        state = await self.mpv.get_state()
        state["nowPlaying"] = self.now_playing
        return state

    # ------------------------------------------------------------- sync loop

    def _start_sync_loop(self):
        self._sync_task = self.loop.create_task(self._sync_loop())

    async def _stop_sync_loop(self):
        if self._sync_task is not None:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except (asyncio.CancelledError, Exception):
                pass
            self._sync_task = None

    async def _sync_loop(self):
        try:
            while True:
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)
                await self._do_sync()
        except asyncio.CancelledError:
            pass

    async def _do_sync(self):
        if not self.session_id:
            return
        try:
            state = await self.mpv.get_state()
            current_time = state.get("currentTime", self._last_synced_time)
            was_playing = state.get("playing", False)
            now = time.monotonic()
            elapsed = max(0.0, now - self._last_sync_wall)
            time_listened = elapsed if was_playing else 0.0
            await self.loop.run_in_executor(
                None, self.client.sync_session, self.session_id, current_time, time_listened
            )
            self._last_sync_wall = now
            self._last_synced_time = current_time
        except Exception as e:
            decky.logger.warning(f"Progress sync failed: {e}")

    async def _close_session_if_any(self):
        if not self.session_id:
            return
        state = await self.mpv.get_state()
        current_time = state.get("currentTime", self._last_synced_time)
        now = time.monotonic()
        elapsed = max(0.0, now - self._last_sync_wall)
        time_listened = elapsed if state.get("playing", False) else 0.0
        try:
            await self.loop.run_in_executor(
                None, self.client.close_session, self.session_id, current_time, time_listened
            )
        finally:
            self.session_id = None
