@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\desktop_launcher.ps1" Stop
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to stop services.
  pause
)
