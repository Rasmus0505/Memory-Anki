from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.testclient import TestClient

from memory_anki.app.main import install_web_cache_headers


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
