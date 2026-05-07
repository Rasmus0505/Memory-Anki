@echo off
title Memory Palace
cd /d "%~dp0"

echo.
echo ============================================
echo   Memory Palace Review System
echo ============================================
echo.

echo [0/2] Killing old processes...

:: 1) Kill by window title (most reliable way to find our own processes)
taskkill /F /FI "WINDOWTITLE eq Memory-Backend" 2>nul
taskkill /F /FI "WINDOWTITLE eq Memory-Frontend" 2>nul

:: 2) Kill anything listening on port 8000 or 5173
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":8000 .*LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":5173 .*LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)

:: 3) Wait for sockets to release
timeout /t 3 /nobreak >nul

:: 4) Double-check ports are free
set RETRIES=0
:check8000
netstat -ano 2>nul | findstr /R /C:":8000 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    set /a RETRIES+=1
    if %RETRIES% LSS 5 (
        for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":8000 .*LISTENING"') do taskkill /F /PID %%a 2>nul
        timeout /t 2 /nobreak >nul
        goto check8000
    )
    echo [!] WARNING: Port 8000 still occupied after 5 retries
) else (
    echo     Port 8000 free ^(retry %RETRIES%^)
)

echo [1/2] Starting backend on port 8000...
start "Memory-Backend" /MIN cmd /c "cd /d "%~dp0backend" && python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload"

echo [2/2] Starting frontend on port 5173...
start "Memory-Frontend" /MIN cmd /c "cd /d "%~dp0frontend" && npx vite --host"

echo.
echo [*] Waiting for servers (6s)...
timeout /t 6 /nobreak >nul

echo [*] Opening browser...
start "" http://localhost:5173

echo.
echo ============================================
echo   Ready - Browser opened
echo   Frontend : http://localhost:5173
echo   Backend  : http://localhost:8000
echo   API Docs : http://localhost:8000/docs
echo ============================================
echo.
echo Backend window : Memory-Backend (check debug info here)
echo Frontend window: Memory-Frontend
echo.

pause
