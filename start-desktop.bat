@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\desktop_launcher.ps1" Start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Desktop startup failed. See logs\api.log and logs\web-dev.log
  pause
)
exit /b %EXIT_CODE%
