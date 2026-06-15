@echo off
setlocal
cd /d "%~dp0"
python "%~dp0tools\start_supervisor.py"
if errorlevel 1 (
  echo.
  echo [!] Failed to start Memory Anki.
  pause
)
