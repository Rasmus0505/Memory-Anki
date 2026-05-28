@echo off
setlocal
title Memory Anki
cd /d "%~dp0"

set "API_DIR=%~dp0apps\api"
set "WEB_DIR=%~dp0apps\web"
set "API_PORT=8012"
set "WEB_PORT=5173"
set "APP_HOME=%LOCALAPPDATA%\MemoryAnki"
set "LEGACY_DATA_DIR=%~dp0data"

if not defined DASHSCOPE_API_KEY (
    for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY','User')"`) do set "DASHSCOPE_API_KEY=%%a"
)
if not defined DASHSCOPE_BASE_URL (
    for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('DASHSCOPE_BASE_URL','User')"`) do set "DASHSCOPE_BASE_URL=%%a"
)

if defined DASHSCOPE_API_KEY (
    echo [i] Loaded DASHSCOPE_API_KEY into this startup session.
) else (
    echo [!] DASHSCOPE_API_KEY is not available in this startup session.
)

echo.
echo ============================================
echo   Memory Anki ^(apps/api + apps/web^)
echo ============================================
echo.

if exist "%LEGACY_DATA_DIR%\memory_palace.db" (
    echo [i] Detected legacy repo data at "%LEGACY_DATA_DIR%".
    echo [i] Runtime data now lives under "%APP_HOME%".
    echo [i] API startup will migrate legacy data into the runtime directory when needed.
    echo.
)

echo [0/2] Cleaning previous dev servers...
taskkill /F /FI "WINDOWTITLE eq Memory-Anki-API" 2>nul
taskkill /F /FI "WINDOWTITLE eq Memory-Anki-WEB" 2>nul

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":%API_PORT% .*LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R /C:":%WEB_PORT% .*LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)

timeout /t 2 /nobreak >nul

echo [1/2] Starting API on port %API_PORT%...
start "Memory-Anki-API" /MIN cmd /c "cd /d "%API_DIR%" && python -m uvicorn --app-dir src memory_anki.app.main:app --host 127.0.0.1 --port %API_PORT% --reload"

echo [2/2] Starting WEB on port %WEB_PORT%...
start "Memory-Anki-WEB" /MIN cmd /c "cd /d "%WEB_DIR%" && npx vite --host 127.0.0.1 --port %WEB_PORT%"

echo.
echo [*] Waiting for servers ^(6s^)...
timeout /t 6 /nobreak >nul

echo [*] Opening browser...
start "" http://localhost:%WEB_PORT%

echo.
echo ============================================
echo   Ready
echo   Web     : http://localhost:%WEB_PORT%
echo   API     : http://127.0.0.1:%API_PORT%/api/v1
echo   API Doc : http://127.0.0.1:%API_PORT%/docs
echo   Data    : %APP_HOME%\data
echo ============================================
echo.
echo Windows:
echo   Memory-Anki-API
echo   Memory-Anki-WEB
echo.

pause
