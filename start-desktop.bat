@echo off
setlocal
cd /d "%~dp0"

echo Checking for updates...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name desktop-update -ScriptPath "%~dp0tools\pwa_launcher.ps1" Update
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Desktop update failed. See the error above and logs\last-launch-error.log
  pause
  exit /b %EXIT_CODE%
)

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name desktop -ScriptPath "%~dp0tools\desktop_launcher.ps1" -ChildSta Start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Desktop startup failed. See the error above and logs\last-launch-error.log
  pause
)
exit /b %EXIT_CODE%