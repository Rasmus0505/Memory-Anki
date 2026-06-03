@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoLogo -NoProfile -File "%~dp0tools\switch-version.ps1" -Target dev
if errorlevel 1 (
  echo.
  echo [!] Failed to switch to dev.
  pause
)
