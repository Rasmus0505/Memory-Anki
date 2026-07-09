@echo off
setlocal
cd /d "%~dp0\.."

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pwa_launcher.ps1" UninstallAutostart
pause
