@echo off
setlocal

where tailscale >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Tailscale CLI was not found. Install Tailscale first.
  pause
  exit /b 1
)

echo Configuring Tailscale Serve for Memory Anki PWA...
tailscale serve --bg 8012
if errorlevel 1 (
  echo.
  echo [ERROR] Tailscale Serve configuration failed.
  echo Right-click this file and choose "Run as administrator", then try again.
  pause
  exit /b 1
)

echo.
echo Done. Open this URL on iPhone Safari while Tailscale is connected:
echo https://desktop-lp-2026481850.tail92e457.ts.net/m
echo.
pause
