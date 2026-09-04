"""
Offline download manager.

Downloads an item's audio tracks (and cover) to local disk under
`<runtime_dir>/downloads/<item_id>/` so playback can continue without a live
connection to the Audiobookshelf server, and so already-downloaded books
aren't re-streamed. Downloads run on a plain background thread (not asyncio)
since they're blocking, chunked HTTP reads via urllib.
"""

import json
import os
import shutil
import threading
import urllib.request


class Downloader:
    def __init__(self, logger, downloads_dir: str):
        self.logger = logger
        self.downloads_dir = downloads_dir
        self._status: dict[str, dict] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        os.makedirs(self.downloads_dir, exist_ok=True)
        self._load_existing()

    def _item_dir(self, item_id: str) -> str:
        return os.path.join(self.downloads_dir, item_id)

    def _meta_path(self, item_id: str) -> str:
        return os.path.join(self._item_dir(item_id), "meta.json")

    def _load_existing(self):
        if not os.path.isdir(self.downloads_dir):
            return
        for item_id in os.listdir(self.downloads_dir):
            if os.path.exists(self._meta_path(item_id)):
                self._status[item_id] = {"state": "done", "progress": 1.0, "error": None}

    # ---------------------------------------------------------------- reads

    def get_status(self, item_id: str) -> dict:
        with self._lock:
            return dict(
                self._status.get(item_id, {"state": "none", "progress": 0.0, "error": None})
            )

    def get_meta(self, item_id: str) -> dict | None:
        path = self._meta_path(item_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def is_downloaded(self, item_id: str) -> bool:
        return self.get_meta(item_id) is not None

    def list_downloaded(self) -> list:
        with self._lock:
            item_ids = [k for k, v in self._status.items() if v.get("state") == "done"]
        result = []
        for item_id in item_ids:
            meta = self.get_meta(item_id)
            if meta:
                result.append(
                    {"itemId": item_id, "title": meta.get("title"), "author": meta.get("author")}
                )
        return result

    def local_tracks(self, item_id: str) -> list | None:
        """Return local track data, or None if the item is not fully downloaded."""
        meta = self.get_meta(item_id)
        if not meta:
            return None
        item_dir = self._item_dir(item_id)
        tracks = []
        for t in meta.get("tracks", []):
            path = os.path.join(item_dir, t["file"])
            if not os.path.exists(path):
                return None
            tracks.append({"url": path, "startOffset": t["startOffset"], "duration": t["duration"]})
        return tracks

    def local_cover_path(self, item_id: str) -> str | None:
        meta = self.get_meta(item_id)
        cover = meta.get("cover") if meta else None
        path = os.path.join(self._item_dir(item_id), cover) if cover else None
        return path if path and os.path.isfile(path) else None

    # ------------------------------------------------------------- actions

    def start_download(
        self, item_id: str, title: str, author: str, cover_url: str, tracks: list, chapters: list
    ):
        with self._lock:
            existing = self._status.get(item_id)
            if existing and existing.get("state") == "downloading":
                return
            self._status[item_id] = {"state": "downloading", "progress": 0.0, "error": None}
            cancel_event = threading.Event()
            self._cancel_events[item_id] = cancel_event

        thread = threading.Thread(
            target=self._run_download,
            args=(item_id, title, author, cover_url, tracks, chapters, cancel_event),
            daemon=True,
        )
        thread.start()

    def cancel_download(self, item_id: str):
        with self._lock:
            event = self._cancel_events.get(item_id)
        if event:
            event.set()

    def delete(self, item_id: str):
        self.cancel_download(item_id)
        item_dir = self._item_dir(item_id)
        if os.path.isdir(item_dir):
            shutil.rmtree(item_dir, ignore_errors=True)
        with self._lock:
            self._status.pop(item_id, None)
            self._cancel_events.pop(item_id, None)

    # ------------------------------------------------------------- worker

    def _run_download(self, item_id, title, author, cover_url, tracks, chapters, cancel_event):
        item_dir = self._item_dir(item_id)
        tmp_dir = item_dir + ".tmp"
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            os.makedirs(tmp_dir, exist_ok=True)

            track_meta = []
            n = max(1, len(tracks))
            for i, t in enumerate(tracks):
                if cancel_event.is_set():
                    raise InterruptedError("cancelled")
                ext = os.path.splitext(t["url"].split("?")[0])[1] or ".audio"
                filename = f"track{i:03d}{ext}"
                self._download_file(
                    t["url"],
                    os.path.join(tmp_dir, filename),
                    cancel_event,
                    base_progress=i / n,
                    span=1 / n,
                    item_id=item_id,
                )
                track_meta.append(
                    {
                        "file": filename,
                        "startOffset": t.get("startOffset", 0),
                        "duration": t.get("duration", 0),
                    }
                )

            cover_file = None
            if cover_url:
                try:
                    cover_file = "cover.jpg"
                    self._download_file(cover_url, os.path.join(tmp_dir, cover_file), cancel_event)
                except Exception as e:
                    self.logger.warning(f"Failed to download cover for {item_id}: {e}")
                    cover_file = None

            meta = {
                "itemId": item_id,
                "title": title,
                "author": author,
                "tracks": track_meta,
                "chapters": chapters,
                "cover": cover_file,
            }
            with open(os.path.join(tmp_dir, "meta.json"), "w", encoding="utf-8") as f:
                json.dump(meta, f)

            shutil.rmtree(item_dir, ignore_errors=True)
            os.replace(tmp_dir, item_dir)

            with self._lock:
                self._status[item_id] = {"state": "done", "progress": 1.0, "error": None}
        except InterruptedError:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            with self._lock:
                self._status[item_id] = {"state": "none", "progress": 0.0, "error": None}
        except Exception as e:
            self.logger.error(f"Download failed for {item_id}: {e}")
            shutil.rmtree(tmp_dir, ignore_errors=True)
            with self._lock:
                self._status[item_id] = {"state": "error", "progress": 0.0, "error": str(e)}
        finally:
            with self._lock:
                self._cancel_events.pop(item_id, None)

    def _download_file(
        self,
        url: str,
        dest: str,
        cancel_event: threading.Event,
        base_progress: float = 0.0,
        span: float = 1.0,
        item_id: str | None = None,
    ):
        with urllib.request.urlopen(url, timeout=30) as resp, open(dest, "wb") as out:
            total = resp.headers.get("Content-Length")
            total = int(total) if total else None
            read = 0
            while True:
                if cancel_event.is_set():
                    raise InterruptedError("cancelled")
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
                read += len(chunk)
                if item_id and total:
                    frac = base_progress + span * min(1.0, read / total)
                    with self._lock:
                        if item_id in self._status:
                            self._status[item_id]["progress"] = frac
