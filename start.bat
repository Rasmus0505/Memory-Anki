@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoLogo -NoProfile -File "%~dp0tools\start-production.ps1"
if errorlevel 1 (
  echo.
  echo [!] Failed to start Memory Anki.
  pause
)
