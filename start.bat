@echo off
setlocal
cd /d "%~dp0"

REM Clear legacy supervisor env overrides
set MEMORY_ANKI_WEB_DIST=
set MEMORY_ANKI_RUNTIME_SNAPSHOT=

set "PYTHON_HOME=%LocalAppData%\Programs\Python\Python312"
set "PYTHON_SCRIPTS=%PYTHON_HOME%\Scripts"
set "NODE_HOME=C:\Program Files\nodejs"

if exist "%PYTHON_HOME%\python.exe" set "PATH=%PYTHON_HOME%;%PYTHON_SCRIPTS%;%PATH%"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

set "PYTHON_CMD="
if exist "%PYTHON_HOME%\python.exe" set "PYTHON_CMD=%PYTHON_HOME%\python.exe"
if not defined PYTHON_CMD (
  where py >nul 2>nul && set "PYTHON_CMD=py -3.12"
)
if not defined PYTHON_CMD (
  where python >nul 2>nul && set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo.
  echo [ERROR] Python 3.12+ was not found.
  echo Install Python and make sure python.exe is available on PATH.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found.
  echo Install Node.js and make sure node.exe is available on PATH.
  pause
  exit /b 1
)

%PYTHON_CMD% "%~dp0tools\dev_server.py"
if errorlevel 1 (
  echo.
  echo [ERROR] Startup failed. See logs\api.log and logs\web-dev.log
  pause
)
