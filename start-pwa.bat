@echo off
setlocal
cd /d "%~dp0"

if /I "%~1"=="--smoke-test" goto smoke_test

echo Checking for updates...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa-update -ScriptPath "%~dp0tools\pwa_launcher.ps1" Update
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] PWA update failed. See the error above and logs\last-launch-error.log
  pause
  exit /b %EXIT_CODE%
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa -ScriptPath "%~dp0tools\pwa_launcher.ps1" Start %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] PWA startup failed. See the error above and logs\last-launch-error.log
  pause
)
exit /b %EXIT_CODE%

:smoke_test
echo Checking PWA launcher in smoke-test mode...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa-smoke-update -ScriptPath "%~dp0tools\pwa_launcher.ps1" Update
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" exit /b %EXIT_CODE%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa-smoke -ScriptPath "%~dp0tools\pwa_launcher.ps1" -Hidden Start --no-supervise
exit /b %ERRORLEVEL%