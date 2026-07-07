@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pwa_launcher.ps1" Stop
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to stop PWA safely. See logs\pwa-startup.log and logs\pwa-api.log if the server was running.
)
exit /b %EXIT_CODE%
