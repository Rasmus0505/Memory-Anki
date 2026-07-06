@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\desktop_launcher.ps1" Start
if errorlevel 1 (
  echo.
  echo [ERROR] Desktop startup failed. See logs\api.log and logs\web-dev.log
  pause
)
