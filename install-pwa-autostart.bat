@echo off
setlocal
cd /d "%~dp0"

echo Installing Windows startup shortcut: Memory Anki PWA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install_pwa_startup_shortcut.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to install startup shortcut.
  pause
  exit /b 1
)

echo.
echo Installed. The PWA server will start automatically after Windows login.
echo You still need to run configure-tailscale-pwa.bat once as Administrator if Tailscale Serve is not configured.
echo.
pause
