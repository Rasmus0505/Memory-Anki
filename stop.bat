@echo off
setlocal
cd /d "%~dp0"
python "%~dp0tools\dev_server.py" --stop
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to stop services.
  pause
)
