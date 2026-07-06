@echo off
setlocal
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Memory Anki PWA.lnk" >nul 2>nul
echo Removed Memory Anki PWA startup shortcut if it existed.
pause
