@echo off
chcp 936 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\cross-device-sync\github-sync.ps1" pull
pause
