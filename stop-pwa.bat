@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_CMD="
if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
  "%LocalAppData%\Programs\Python\Python313\python.exe" -c "from pydantic_settings import BaseSettings; from dotenv import load_dotenv" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python313\python.exe"
)
if not defined PYTHON_CMD (
  python -c "from pydantic_settings import BaseSettings; from dotenv import load_dotenv" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo [ERROR] No usable Python runtime was found.
  pause
  exit /b 1
)

"%PYTHON_CMD%" "%~dp0tools\pwa_server.py" --stop
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Failed to stop PWA safely. See logs\pwa-api.log if the server was running.
)
exit /b %EXIT_CODE%
