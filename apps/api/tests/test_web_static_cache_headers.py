import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.testclient import TestClient

from memory_anki.app.main import SinglePageAppStaticFiles, install_web_cache_headers


def test_web_routes_disable_cache_while_api_routes_keep_default_headers():
    app = FastAPI()
    install_web_cache_headers(app)

    @app.get("/")
    def home():
        return PlainTextResponse("ok")

    @app.get("/assets/app.js")
    def asset():
        return PlainTextResponse("console.log('ok')")

    @app.get("/api/ping")
    def api_ping():
        return JSONResponse({"ok": True})

    client = TestClient(app)

    home_response = client.get("/")
    asset_response = client.get("/assets/app.js")
    api_response = client.get("/api/ping")

    assert home_response.headers["cache-control"] == "no-cache"
    assert asset_response.headers["cache-control"] == "no-cache"
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
