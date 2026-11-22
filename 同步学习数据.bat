@echo off
chcp 936 >nul
set "SYNC=%~dp0tools\cross-device-sync\github-sync.ps1"
if not exist "%SYNC%" (
  echo 找不到 tools\cross-device-sync\github-sync.ps1。
  pause
  exit /b 1
)

:menu
echo.
echo ============================================
echo   Memory Anki 学习进度同步
echo ============================================
echo.
echo   [1] 上传本机学习进度
echo   [2] 下载远端学习进度
echo   [3] 查看同步状态
echo   [0] 退出
echo.
choice /c 1230 /n /m "按数字键选择，不用按回车："
set "PICK=%ERRORLEVEL%"
if "%PICK%"=="4" exit /b 0
if "%PICK%"=="1" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SYNC%" push
if "%PICK%"=="2" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SYNC%" pull
if "%PICK%"=="3" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SYNC%" status
echo.
pause
goto menu
