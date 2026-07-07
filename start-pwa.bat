@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pwa_launcher.ps1" Start %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] PWA startup failed. See logs\pwa-startup.log, logs\pwa-api.log and logs\pwa-build.log
  pause
)
exit /b %EXIT_CODE%
