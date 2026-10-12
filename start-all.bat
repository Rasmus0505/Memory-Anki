@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if /I "%~1"=="--smoke-test" goto smoke_test
if /I "%~1"=="stop" goto stop_only

echo Stopping any running Memory Anki service...
call :stop_running
if errorlevel 1 (
  echo.
  echo [ERROR] Could not stop the running service. Start aborted so nothing is half-updated.
  pause
  exit /b 1
)

echo Checking for updates...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name start-all-update -ScriptPath "%~dp0tools\pwa_launcher.ps1" Update
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Update failed. See the error above and logs\last-launch-error.log
  pause
  exit /b %EXIT_CODE%
)

echo Starting PWA...
start "Memory Anki PWA" /D "%~dp0" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa -ScriptPath "%~dp0tools\pwa_launcher.ps1" Start

echo Preparing palace and question text before the window opens...
echo Starting Desktop...
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name desktop -ScriptPath "%~dp0tools\desktop_launcher.ps1" -ChildSta Start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Desktop startup failed. See the error above and logs\last-launch-error.log
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Launch complete.
exit /b 0

:stop_only
call :stop_running
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Memory Anki service is still running on port 8012. See logs\last-launch-error.log
  pause
)
exit /b %EXIT_CODE%

:stop_running
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name desktop-stop -ScriptPath "%~dp0tools\desktop_launcher.ps1" Stop
if not "%ERRORLEVEL%"=="0" echo [!] Desktop stop reported an error; checking the service port directly.
call :ensure_backend_stopped
exit /b %ERRORLEVEL%

:ensure_backend_stopped
call :find_backend_pid
if not defined BACKEND_PID exit /b 0
set "BACKEND_NAME="
for /f "usebackq delims=" %%n in (`powershell.exe -NoProfile -Command "(Get-Process -Id %BACKEND_PID% -ErrorAction SilentlyContinue).ProcessName"`) do set "BACKEND_NAME=%%n"
if /I not "%BACKEND_NAME%"=="python" (
  echo [ERROR] Port 8012 is held by "%BACKEND_NAME%" ^(PID %BACKEND_PID%^), not a Memory Anki python service. Not killing it.
  exit /b 1
)
echo [i] Service still listening on port 8012 ^(PID %BACKEND_PID%^). Force-stopping it.
taskkill /F /PID %BACKEND_PID% >nul 2>&1
set "WAITED=0"
:wait_port_free
call :find_backend_pid
if not defined BACKEND_PID exit /b 0
if %WAITED% GEQ 15 (
  echo [ERROR] Port 8012 is still held by PID %BACKEND_PID% after 15 seconds.
  exit /b 1
)
set /a WAITED+=1
ping -n 2 127.0.0.1 >nul
goto wait_port_free

:find_backend_pid
set "BACKEND_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr ":8012" ^| findstr "LISTENING"') do set "BACKEND_PID=%%p"
exit /b 0

:smoke_test
echo Checking PWA launcher in smoke-test mode...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa-smoke-update -ScriptPath "%~dp0tools\pwa_launcher.ps1" Update
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" exit /b %EXIT_CODE%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run_with_diagnostics.ps1" -Name pwa-smoke -ScriptPath "%~dp0tools\pwa_launcher.ps1" -Hidden Start --no-supervise
exit /b %ERRORLEVEL%
