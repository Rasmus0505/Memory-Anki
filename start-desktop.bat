@echo off
setlocal
cd /d "%~dp0"

python "%~dp0tools\desktop_timer.py"
if errorlevel 1 (
  echo.
  echo [ERROR] Desktop startup failed. See logs\api.log and logs\web-dev.log
  pause
)
