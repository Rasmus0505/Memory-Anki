@echo off
setlocal
cd /d "%~dp0"

echo Stopping running services...
call "%~dp0tools\stop.bat"
set "STOP_CODE=%ERRORLEVEL%"
if not "%STOP_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to stop existing services.
  pause
  exit /b %STOP_CODE%
)

echo Rebuilding update-ready PWA assets...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pwa_launcher.ps1" Update
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Update failed. See logs\pwa-build.log, logs\runtime-prepare.log and logs\runtime-migrate.log
  pause
)
exit /b %EXIT_CODE%
