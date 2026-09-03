"""
Local test harness for the Decky backend logic - lets you exercise
`main.Plugin` (auth, library browsing, downloads, mpv detection) on your dev
machine without deploying to a Steam Deck or running Decky Loader at all.

This stubs out the `decky` module (which is normally injected by Decky
Loader at runtime) with a minimal local equivalent that writes to a
`.dev-data/` folder next to this script.

Limitations:
- Actual mpv playback control uses a Unix domain socket for IPC, which
  Python's asyncio does not support on Windows. Run this under WSL2/Linux/
  macOS (with `mpv` installed) to test real playback; on native Windows you
  can still test login, library browsing, and downloading.
- This does not test the frontend, the Decky <-> Steam overlay integration,
  or the `callable()` RPC dispatch - only the plugin's Python logic.

Usage:
    python dev/local_test.py

Set these once prompted (or via env vars ABS_SERVER_URL / ABS_USERNAME /
ABS_PASSWORD) to point at a real Audiobookshelf server.
"""
import asyncio
import logging
import os
import sys
import types

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV_DATA_DIR = os.path.join(REPO_ROOT, "dev", ".dev-data")


def _install_decky_stub():
    settings_dir = os.path.join(DEV_DATA_DIR, "settings")
    runtime_dir = os.path.join(DEV_DATA_DIR, "runtime")
    log_dir = os.path.join(DEV_DATA_DIR, "logs")
    for d in (settings_dir, runtime_dir, log_dir):
        os.makedirs(d, exist_ok=True)

    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

    decky = types.ModuleType("decky")
    decky.HOME = os.path.expanduser("~")
    decky.USER = os.environ.get("USER", "dev")
    decky.DECKY_VERSION = "dev-local"
    decky.DECKY_USER = decky.USER
    decky.DECKY_USER_HOME = decky.HOME
    decky.DECKY_HOME = DEV_DATA_DIR
    decky.DECKY_PLUGIN_SETTINGS_DIR = settings_dir
    decky.DECKY_PLUGIN_RUNTIME_DIR = runtime_dir
    decky.DECKY_PLUGIN_LOG_DIR = log_dir
    decky.DECKY_PLUGIN_DIR = REPO_ROOT
    decky.DECKY_PLUGIN_NAME = "Audiobookshelf (local dev)"
    decky.DECKY_PLUGIN_VERSION = "0.0.1"
    decky.DECKY_PLUGIN_AUTHOR = "dev"
    decky.DECKY_PLUGIN_LOG = os.path.join(log_dir, "plugin.log")
    decky.logger = logging.getLogger("decky")

    async def emit(event, *args):
        decky.logger.info(f"[emit] {event} {args}")

    decky.emit = emit
    sys.modules["decky"] = decky


async def main():
    _install_decky_stub()
    sys.path.insert(0, os.path.join(REPO_ROOT, "py_modules"))
    sys.path.insert(0, REPO_ROOT)
    from main import Plugin  # noqa: E402

    plugin = Plugin()
    await plugin._main()

    cfg = await plugin.get_config()
    print("Config:", cfg)

    if not cfg["configured"]:
        server_url = os.environ.get("ABS_SERVER_URL") or input("Server URL: ")
        username = os.environ.get("ABS_USERNAME") or input("Username: ")
        password = os.environ.get("ABS_PASSWORD") or input("Password: ")
        result = await plugin.login(server_url, username, password, True)
        print("Login result:", result)
        if not result["success"]:
            return

    libs = await plugin.get_libraries()
    print("Libraries:", libs)

    mpv_status = await plugin.get_mpv_status()
    print("mpv status:", mpv_status)

    if libs["success"] and libs["libraries"]:
        lib_id = libs["libraries"][0]["id"]
        items = await plugin.get_library_items(lib_id, "")
        print(f"Items in '{libs['libraries'][0]['name']}':")
        for item in items.get("items", [])[:10]:
            print(f"  - {item['title']} ({item['id']})")

    await plugin._unload()


if __name__ == "__main__":
    asyncio.run(main())
