"""
Minimal Audiobookshelf HTTP API client.

Deliberately implemented with only the Python standard library (urllib) so
that no extra pip dependencies need to be installed on the Steam Deck.

API reference: https://api.audiobookshelf.org/
"""
import json
import base64
import urllib.request
import urllib.parse
import urllib.error


class ABSError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class ABSClient:
    def __init__(self, server_url: str = "", token: str = ""):
        self.set_server_url(server_url)
        self.token = token or ""

    def set_server_url(self, server_url: str):
        self.server_url = (server_url or "").rstrip("/")

    def set_token(self, token: str):
        self.token = token or ""

    @property
    def configured(self) -> bool:
        return bool(self.server_url and self.token)

    def _request(self, method: str, path: str, query: dict | None = None,
                 body: dict | None = None, timeout: float = 15.0) -> dict:
        if not self.server_url:
            raise ABSError("Server URL is not configured")

        url = f"{self.server_url}{path}"
        if query:
            clean = {k: v for k, v in query.items() if v is not None}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)

        data = None
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if not raw:
                    return {}
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            try:
                parsed = json.loads(msg)
                msg = parsed.get("error") or parsed.get("message") or msg
            except Exception:
                pass
            raise ABSError(f"HTTP {e.code}: {msg}", status=e.code) from e
        except urllib.error.URLError as e:
            raise ABSError(f"Connection failed: {e.reason}") from e

    # ---- Auth ----

    def login(self, username: str, password: str) -> dict:
        """Returns the raw /login response (contains 'user': {'token': ...})."""
        return self._request("POST", "/login", body={
            "username": username,
            "password": password,
        })

    def get_me(self) -> dict:
        return self._request("GET", "/api/me")

    def get_media_progress(self) -> list:
        """Return the current user's progress records in the legacy API shape."""
        result = self._request("GET", "/api/me/progress")
        return result.get("mediaProgress", []) or []

    # ---- Libraries ----

    def get_libraries(self) -> list:
        result = self._request("GET", "/api/libraries")
        return result.get("libraries", [])

    def get_library_items(self, library_id: str, search: str | None = None,
                           limit: int = 50, page: int = 0, sort: str | None = None) -> dict:
        if search:
            result = self._request("GET", f"/api/libraries/{library_id}/search", query={
                "q": search,
                "limit": limit,
            })
            # /search groups results by type; flatten "book" matches to look like /items results
            books = result.get("book", []) or []
            items = [b.get("libraryItem", b) for b in books]
            return {"results": items, "total": len(items)}
        return self._request("GET", f"/api/libraries/{library_id}/items", query={
            "limit": limit,
            "page": page,
            "sort": sort,
        })

    # ---- Items ----

    def get_item(self, item_id: str) -> dict:
        return self._request("GET", f"/api/items/{item_id}", query={
            "expanded": 1,
            "include": "progress",
        })

    def cover_url(self, item_id: str) -> str:
        token_q = urllib.parse.quote(self.token)
        return f"{self.server_url}/api/items/{item_id}/cover?token={token_q}"

    def cover_data_url(self, item_id: str) -> str:
        url = self.cover_url(item_id)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                content_type = resp.headers.get_content_type() or "image/jpeg"
                image = resp.read(2 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as e:
            raise ABSError(f"HTTP {e.code}: unable to load cover", status=e.code) from e
        except urllib.error.URLError as e:
            raise ABSError(f"Connection failed: {e.reason}") from e
        if len(image) > 2 * 1024 * 1024:
            raise ABSError("Cover image is larger than 2 MiB")
        return f"data:{content_type};base64,{base64.b64encode(image).decode('ascii')}"

    # ---- Playback sessions ----

    def start_playback_session(self, item_id: str, episode_id: str | None = None) -> dict:
        path = f"/api/items/{item_id}/play"
        if episode_id:
            path += f"/{episode_id}"
        return self._request("POST", path, body={
            "deviceInfo": {
                "clientName": "Decky Audiobookshelf",
                "clientVersion": "0.0.1",
            },
            "forceDirectPlay": True,
            "supportedMimeTypes": [
                "audio/flac", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/aac", "audio/x-m4a"
            ],
            "mediaPlayer": "mpv",
        })

    def sync_session(self, session_id: str, current_time: float, time_listened: float):
        return self._request("POST", f"/api/session/{session_id}/sync", body={
            "currentTime": current_time,
            "timeListened": time_listened,
        })

    def close_session(self, session_id: str, current_time: float, time_listened: float):
        return self._request("POST", f"/api/session/{session_id}/close", body={
            "currentTime": current_time,
            "timeListened": time_listened,
        })

    def media_url(self, content_url: str) -> str:
        """Turns a relative contentUrl (e.g. '/s/item/li_xxx/file.mp3') into an
        absolute, token-authenticated URL mpv can stream directly."""
        token_q = urllib.parse.quote(self.token)
        sep = "&" if "?" in content_url else "?"
        return f"{self.server_url}{content_url}{sep}token={token_q}"
