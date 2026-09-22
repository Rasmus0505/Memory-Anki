@echo off
setlocal EnableExtensions
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name desktop-stop -ScriptPath "%~dp0tools\desktop_launcher.ps1" Stop
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to stop services. See logs\last-launch-error.log
  pause
)
exit /b %EXIT_CODE%
