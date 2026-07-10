@echo off
setlocal
cd /d "%~dp0\.."

echo Installing Windows startup shortcut: Memory Anki PWA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pwa_launcher.ps1" InstallAutostart
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to install startup shortcut.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Installed. The PWA server will start automatically after Windows login.
echo You still need to run tools\configure-tailscale-pwa.bat once as Administrator if Tailscale Serve is not configured.
echo.
pause
exit /b 0
