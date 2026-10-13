@echo off
setlocal EnableExtensions
rem One-click dev page: starts the Vite dev server for apps\web and opens /freestyle-2.
rem Dev mode proxies /api to the local live service on 8012, so the desktop app must be running.
rem Do NOT set MEMORY_ANKI_E2E here: that disables the proxy and turns every API call into 503.

cd /d "%~dp0apps\web" || (
  echo [ERROR] apps\web not found next to this script.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [ERROR] node_modules is missing. Run "npm install" inside apps\web first.
  pause
  exit /b 1
)

echo Starting web dev server on http://localhost:5173 ...
start "Memory Anki web dev" cmd /k "cd /d "%~dp0apps\web" && npm run dev -- --port 5173 --strictPort"

rem Give Vite a few seconds to bind the port before opening the browser.
timeout /t 6 /nobreak >nul
start "" "http://localhost:5173/freestyle-2"

echo Opened http://localhost:5173/freestyle-2
echo In the browser press F12 and open the Console tab. Keep "Preserve log" on.
echo To stop the dev server, close the "Memory Anki web dev" window or press Ctrl+C there.
endlocal
