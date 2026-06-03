@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoLogo -NoProfile -File "%~dp0tools\promote-stable.ps1"
if errorlevel 1 (
  echo.
  echo [!] Failed to promote current commit to stable.
  pause
)
