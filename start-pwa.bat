@echo off
setlocal
cd /d "%~dp0"

set "NODE_HOME=C:\Program Files\nodejs"

if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

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
  echo Install dependencies with: python -m pip install -r apps\api\requirements.txt
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found.
  pause
  exit /b 1
)

"%PYTHON_CMD%" "%~dp0tools\pwa_server.py" --build %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] PWA startup failed. See logs\pwa-api.log and logs\pwa-build.log
  pause
)
exit /b %EXIT_CODE%
