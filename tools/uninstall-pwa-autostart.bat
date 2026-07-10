@echo off
setlocal
cd /d "%~dp0\.."

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_with_diagnostics.ps1" -Name pwa-autostart-uninstall -ScriptPath "%~dp0pwa_launcher.ps1" UninstallAutostart
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to remove startup shortcut. See logs\last-launch-error.log
)
pause
exit /b %EXIT_CODE%
