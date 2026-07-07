@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pwa_launcher.ps1" UninstallAutostart
pause
