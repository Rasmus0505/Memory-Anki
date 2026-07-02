@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_HOME=%LocalAppData%\Programs\Python\Python312"
set "PYTHON_SCRIPTS=%PYTHON_HOME%\Scripts"

if exist "%PYTHON_HOME%\python.exe" set "PATH=%PYTHON_HOME%;%PYTHON_SCRIPTS%;%PATH%"

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
  echo [ERROR] Python 3.12+ was not found, so services cannot be stopped.
  pause
  exit /b 1
)

%PYTHON_CMD% "%~dp0tools\dev_server.py" --stop
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to stop services.
  pause
)
