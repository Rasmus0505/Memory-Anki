import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.testclient import TestClient

from memory_anki.app.main import SinglePageAppStaticFiles, install_web_cache_headers


def test_app_import_prepares_static_attachment_directory(tmp_path):
    app_home = tmp_path / "fresh-app-home"
    api_src = Path(__file__).resolve().parents[1] / "src"
    env = os.environ.copy()
    env["MEMORY_ANKI_HOME"] = str(app_home)
    env["MEMORY_ANKI_WEB_DIST"] = ""
    env["PYTHONPATH"] = os.pathsep.join(
        value for value in (str(api_src), env.get("PYTHONPATH", "")) if value
    )
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                f"import sys; sys.path.insert(0, {str(api_src)!r}); "
                "from memory_anki.app.main import app; "
                "from memory_anki.core.config import ATTACHMENTS_DIR; "
                "assert ATTACHMENTS_DIR.is_dir(); print(ATTACHMENTS_DIR)"
            ),
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert str(app_home) in result.stdout


def test_web_routes_cache_entrypoints_and_versioned_assets_separately():
    app = FastAPI()
    install_web_cache_headers(app)

    @app.get("/")
    def home():
        return PlainTextResponse("ok")

    @app.get("/assets/app.js")
    def asset():
        return PlainTextResponse("console.log('ok')")

    @app.get("/assets/app-a1b2c3d4.js")
    def hashed_asset():
        return PlainTextResponse("console.log('ok')")

    @app.get("/assets/recovery-a1b2c3d4.js")
    def recovery_asset():
        return PlainTextResponse(
            "location.replace('/pwa-reset.html')",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/ping")
    def api_ping():
        return JSONResponse({"ok": True})

    client = TestClient(app)

    home_response = client.get("/")
    asset_response = client.get("/assets/app.js")
    hashed_asset_response = client.get("/assets/app-a1b2c3d4.js")
    recovery_asset_response = client.get("/assets/recovery-a1b2c3d4.js")
    api_response = client.get("/api/ping")

    assert home_response.headers["cache-control"] == "no-cache"
    assert asset_response.headers["cache-control"] == "no-cache"
    assert hashed_asset_response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert recovery_asset_response.headers["cache-control"] == "no-store"
    assert "cache-control" not in {key.lower(): value for key, value in api_response.headers.items()}


def test_single_page_static_files_fall_back_to_index_for_frontend_routes():
    temp_dir = tempfile.TemporaryDirectory()
    try:
        web_dist = Path(temp_dir.name)
        (web_dist / "index.html").write_text("<html><body>spa</body></html>", encoding="utf-8")
        (web_dist / "assets").mkdir(parents=True, exist_ok=True)
        (web_dist / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")

        app = FastAPI()
        app.mount("/", SinglePageAppStaticFiles(directory=str(web_dist), html=True), name="web")
        client = TestClient(app)

        route_response = client.get("/profile")
        asset_response = client.get("/assets/app.js")
        missing_asset_response = client.get("/favicon.ico")

        assert route_response.status_code == 200
        assert "spa" in route_response.text
        assert asset_response.status_code == 200
        assert missing_asset_response.status_code == 404
    finally:
        temp_dir.cleanup()


def test_single_page_static_files_rejects_stale_release_assets():
    temp_dir = tempfile.TemporaryDirectory()
    try:
        web_dist = Path(temp_dir.name)
        (web_dist / "index.html").write_text("<html><body>spa</body></html>", encoding="utf-8")
        (web_dist / "assets").mkdir(parents=True, exist_ok=True)

        app = FastAPI()
        app.mount("/", SinglePageAppStaticFiles(directory=str(web_dist), html=True), name="web")
        client = TestClient(app)

        script_response = client.get("/assets/index-oldhash.js")
        style_response = client.get("/assets/index-oldhash.css")

        assert script_response.status_code == 404
        assert style_response.status_code == 404
    finally:
        temp_dir.cleanup()
