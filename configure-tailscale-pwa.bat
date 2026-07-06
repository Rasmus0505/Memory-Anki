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

echo Configuring Tailscale Serve for Memory Anki PWA...
"%PYTHON_CMD%" "%~dp0tools\pwa_server.py" --configure-serve --no-supervise %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Tailscale Serve configuration failed.
  echo Right-click this file and choose "Run as administrator", then try again.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Done. Open the HTTPS Tailscale URL shown above on your phone, then visit /freestyle.
echo.
pause
exit /b 0
