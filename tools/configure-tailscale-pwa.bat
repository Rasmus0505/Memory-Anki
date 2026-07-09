@echo off
setlocal
cd /d "%~dp0\.."

echo Configuring Tailscale Serve for Memory Anki PWA...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pwa_launcher.ps1" ConfigureServe %*
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
