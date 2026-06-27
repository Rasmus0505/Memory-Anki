@echo off
setlocal
cd /d "%~dp0"

REM Clear legacy supervisor env overrides
set MEMORY_ANKI_HOME=
set MEMORY_ANKI_WEB_DIST=
set MEMORY_ANKI_RUNTIME_SNAPSHOT=

REM Run dev server using absolute path
python "%~dp0tools\dev_server.py"
if errorlevel 1 (
  echo.
  echo [ERROR] Startup failed. See logspi.log and logs\web-dev.log
  pause
)
