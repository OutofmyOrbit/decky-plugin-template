"""
Headless mpv playback controller driven over its JSON IPC socket.

mpv is spawned as a subprocess (`--idle=yes --input-ipc-server=<socket>`) and
every control action (play/pause/seek/chapter) is sent as a JSON command over
that socket. This avoids any extra Python dependencies (no python-mpv/libmpv
bindings needed) - only the `mpv` binary must be present on the system, which
it is by default on SteamOS.
"""
import asyncio
import json
import os
import shutil
import subprocess
import time


class MPVError(Exception):
    pass


class MPVController:
    def __init__(self, logger, runtime_dir: str):
        self.logger = logger
        self.runtime_dir = runtime_dir
        self.proc: subprocess.Popen | None = None
        self.ipc_path: str | None = None
        self.tracks: list[dict] = []
        self.chapters: list[dict] = []
        self.total_duration: float = 0.0
        self._lock = asyncio.Lock()

    # ---------------------------------------------------------------- utils

    @staticmethod
    def mpv_available() -> bool:
        return shutil.which("mpv") is not None

    def _locate(self, global_time: float):
        """Returns (track_index, local_offset_seconds) for a global time position."""
        if not self.tracks:
            return 0, max(0.0, global_time)
        for i, t in enumerate(self.tracks):
            start = t["startOffset"]
            end = start + t["duration"]
            if global_time < end or i == len(self.tracks) - 1:
                return i, max(0.0, global_time - start)
        return 0, 0.0

    def _global_time(self, track_index: int, local_time: float) -> float:
        if 0 <= track_index < len(self.tracks):
            return self.tracks[track_index]["startOffset"] + local_time
        return local_time

    # ---------------------------------------------------------------- ipc

    async def _send(self, cmd: dict, timeout: float = 3.0) -> dict:
        if not self.ipc_path:
            raise MPVError("mpv is not running")
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_unix_connection(self.ipc_path), timeout=timeout
            )
        except (OSError, asyncio.TimeoutError) as e:
            raise MPVError(f"Could not connect to mpv IPC socket: {e}") from e

        try:
            writer.write((json.dumps(cmd) + "\n").encode("utf-8"))
            await writer.drain()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                remaining = max(0.05, deadline - time.monotonic())
                line = await asyncio.wait_for(reader.readline(), timeout=remaining)
                if not line:
                    break
                try:
                    resp = json.loads(line.decode("utf-8"))
                except json.JSONDecodeError:
                    continue
                if "event" in resp:
                    continue  # skip async events, we only want the command reply
                return resp
            return {}
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _get_property(self, name: str):
        resp = await self._send({"command": ["get_property", name]})
        if resp.get("error") not in (None, "success"):
            return None
        return resp.get("data")

    async def _set_property(self, name: str, value):
        await self._send({"command": ["set_property", name, value]})

    async def _wait_for_socket(self, timeout: float = 8.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.ipc_path and os.path.exists(self.ipc_path):
                # give mpv a beat to actually start listening on it
                for _ in range(20):
                    try:
                        r, w = await asyncio.open_unix_connection(self.ipc_path)
                        w.close()
                        return
                    except OSError:
                        await asyncio.sleep(0.1)
                return
            await asyncio.sleep(0.1)
        raise MPVError("Timed out waiting for mpv to start")

    # ------------------------------------------------------------ lifecycle

    async def start(self, tracks: list[dict], chapters: list[dict], start_time: float):
        """tracks: [{url, startOffset, duration}, ...] ordered by playback order."""
        if not self.mpv_available():
            raise MPVError("mpv binary not found. Install mpv to enable audio playback.")

        await self.stop()

        self.tracks = tracks
        self.chapters = chapters or []
        self.total_duration = (
            (tracks[-1]["startOffset"] + tracks[-1]["duration"]) if tracks else 0.0
        )

        os.makedirs(self.runtime_dir, exist_ok=True)
        self.ipc_path = os.path.join(self.runtime_dir, f"mpv-ipc-{os.getpid()}.sock")
        if os.path.exists(self.ipc_path):
            try:
                os.remove(self.ipc_path)
            except OSError:
                pass

        idx, local = self._locate(start_time or 0.0)

        args = [
            "mpv",
            "--no-video",
            "--idle=yes",
            "--really-quiet",
            "--no-terminal",
            f"--input-ipc-server={self.ipc_path}",
            f"--start={local:.3f}",
        ] + [t["url"] for t in tracks]

        self.logger.info(f"Starting mpv: {' '.join(args[:6])} ... ({len(tracks)} track(s))")
        self.proc = subprocess.Popen(
            args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )

        try:
            await self._wait_for_socket()
        except MPVError:
            await self.stop()
            raise

        if idx > 0:
            await self._send({"command": ["playlist-play-index", idx]})
            await self._send({"command": ["seek", local, "absolute"]})

    async def stop(self):
        if self.proc is not None:
            try:
                await self._send({"command": ["quit"]}, timeout=1.0)
            except Exception:
                pass
            try:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            except Exception:
                pass
            self.proc = None
        if self.ipc_path and os.path.exists(self.ipc_path):
            try:
                os.remove(self.ipc_path)
            except OSError:
                pass
        self.ipc_path = None

    @property
    def is_running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    # --------------------------------------------------------------- control

    async def toggle_pause(self):
        async with self._lock:
            cur = await self._get_property("pause")
            await self._set_property("pause", not bool(cur))

    async def pause(self):
        async with self._lock:
            await self._set_property("pause", True)

    async def resume(self):
        async with self._lock:
            await self._set_property("pause", False)

    async def seek_to(self, global_time: float):
        async with self._lock:
            global_time = max(0.0, min(global_time, self.total_duration or global_time))
            idx, local = self._locate(global_time)
            cur_idx = await self._get_property("playlist-pos") or 0
            if idx != cur_idx:
                await self._send({"command": ["playlist-play-index", idx]})
            await self._send({"command": ["seek", local, "absolute"]})

    async def seek_relative(self, delta_seconds: float):
        state = await self.get_state()
        await self.seek_to(state["currentTime"] + delta_seconds)

    async def set_speed(self, speed: float):
        async with self._lock:
            await self._set_property("speed", speed)

    def _chapter_at(self, global_time: float):
        for i, c in enumerate(self.chapters):
            if c["start"] <= global_time < c["end"]:
                return i, c
        return -1, None

    async def next_chapter(self):
        state = await self.get_state()
        idx, _ = self._chapter_at(state["currentTime"])
        if idx >= 0 and idx + 1 < len(self.chapters):
            await self.seek_to(self.chapters[idx + 1]["start"])
        elif self.chapters and idx == -1:
            await self.seek_to(self.chapters[0]["start"])

    async def prev_chapter(self):
        state = await self.get_state()
        idx, chapter = self._chapter_at(state["currentTime"])
        if idx > 0:
            # if we're more than 3s into the current chapter, restart it; else go back one
            if chapter and state["currentTime"] - chapter["start"] > 3:
                await self.seek_to(chapter["start"])
            else:
                await self.seek_to(self.chapters[idx - 1]["start"])
        elif idx == 0:
            await self.seek_to(self.chapters[0]["start"])

    async def set_chapter(self, chapter_id):
        for c in self.chapters:
            if c["id"] == chapter_id:
                await self.seek_to(c["start"])
                return

    async def get_state(self) -> dict:
        if not self.is_running or not self.ipc_path:
            return {
                "running": False,
                "playing": False,
                "currentTime": 0,
                "duration": self.total_duration,
                "chapterIndex": -1,
                "chapterTitle": None,
                "chapters": self.chapters,
                "speed": 1.0,
            }
        async with self._lock:
            pause = await self._get_property("pause")
            time_pos = await self._get_property("time-pos") or 0.0
            playlist_pos = await self._get_property("playlist-pos") or 0
            speed = await self._get_property("speed") or 1.0
        global_time = self._global_time(playlist_pos, time_pos)
        idx, chapter = self._chapter_at(global_time)
        return {
            "running": True,
            "playing": not bool(pause),
            "currentTime": global_time,
            "duration": self.total_duration,
            "chapterIndex": idx,
            "chapterTitle": chapter["title"] if chapter else None,
            "chapters": self.chapters,
            "speed": speed,
        }
