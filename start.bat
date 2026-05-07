@echo off
title Memory Palace
cd /d "%~dp0"

echo.
echo ============================================
echo   Memory Palace Review System
echo ============================================
echo.

echo [*] Cleaning old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000.*LISTENING" 2^>nul') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173.*LISTENING" 2^>nul') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

echo [1/2] Starting backend on port 8000 (hot-reload)...
start "Memory-Backend" /MIN cmd /c "cd /d "%~dp0backend" && python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload"

echo [2/2] Starting frontend on port 5173 (HMR)...
start "Memory-Frontend" /MIN cmd /c "cd /d "%~dp0frontend" && npx vite --host"

echo.
echo [*] Waiting for servers (5s)...
timeout /t 5 /nobreak >nul

echo [*] Opening browser...
start "" http://localhost:5173

echo.
echo ============================================
echo   Ready - Browser opened
echo   Frontend : http://localhost:5173 (HMR)
echo   Backend  : http://localhost:8000 (hot-reload)
echo   API Docs : http://localhost:8000/docs
echo ============================================
echo.
echo Server windows are minimized to taskbar.
echo Code changes auto-reload - no restart needed.
echo.

pause
