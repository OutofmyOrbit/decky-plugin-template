import os
import json
import time
import asyncio

import decky

from abs_client import ABSClient, ABSError
from mpv_controller import MPVController, MPVError

SYNC_INTERVAL_SECONDS = 20


def _config_path() -> str:
    return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "config.json")


class Plugin:
    async def _main(self):
        self.loop = asyncio.get_event_loop()
        self.client = ABSClient()
        self.mpv = MPVController(decky.logger, decky.DECKY_PLUGIN_RUNTIME_DIR)

        self.session_id: str | None = None
        self.now_playing: dict | None = None
        self._last_sync_wall: float = 0.0
        self._last_synced_time: float = 0.0
        self._sync_task: asyncio.Task | None = None

        self._load_config()
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

    def _save_config(self):
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump({
                "server_url": self.client.server_url,
                "token": self.client.token,
                "username": getattr(self, "_username", ""),
            }, f)

    # ------------------------------------------------------------- auth api

    async def get_config(self) -> dict:
        return {
            "configured": self.client.configured,
            "server_url": self.client.server_url,
            "username": getattr(self, "_username", ""),
        }

    async def login(self, server_url: str, username: str, password: str) -> dict:
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
        self._save_config()
        return {"success": True}

    async def check_connection(self) -> dict:
        try:
            me = await self.loop.run_in_executor(None, self.client.get_me)
            return {"success": True, "username": me.get("username")}
        except ABSError as e:
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
                None, self.client.get_library_items, library_id, (search or None)
            )
            items = []
            for it in data.get("results", []):
                media = it.get("media", {}) or {}
                meta = media.get("metadata", {}) or {}
                progress = it.get("userMediaProgress") or {}
                items.append({
                    "id": it.get("id"),
                    "title": meta.get("title") or "Unknown title",
                    "author": meta.get("authorName") or meta.get("author") or "",
                    "duration": media.get("duration", 0),
                    "progress": progress.get("progress", 0),
                    "isFinished": progress.get("isFinished", False),
                    "currentTime": progress.get("currentTime", 0),
                    "coverUrl": self.client.cover_url(it.get("id")),
                })
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
            }
        except ABSError as e:
            return {"success": False, "error": str(e)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------- playback api

    async def play_item(self, item_id: str) -> dict:
        if not MPVController.mpv_available():
            return {"success": False, "error": "mpv is not installed on this system"}
        try:
            await self._stop_sync_loop()
            try:
                await self._close_session_if_any()
            except Exception:
                pass

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

            start_time = session.get("currentTime", 0) or 0

            await self.mpv.start(tracks, chapters, start_time)

            self.session_id = session.get("id")
            self.now_playing = {
                "itemId": item_id,
                "title": session.get("displayTitle") or "Unknown title",
                "author": session.get("displayAuthor") or "",
                "coverUrl": self.client.cover_url(item_id),
            }
            self._last_sync_wall = time.monotonic()
            self._last_synced_time = start_time
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
