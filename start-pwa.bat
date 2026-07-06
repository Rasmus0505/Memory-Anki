@echo off
REM ====================================
REM 启动记忆宫殿 PWA 服务器
REM
REM 功能：
REM - 构建完整桌面端前端
REM - 启动后端 API 服务器
REM - 提供生产环境 PWA 访问
REM
REM 访问地址：
REM - 本机：http://127.0.0.1:8012/
REM - 默认入口：http://127.0.0.1:8012/freestyle
REM - 手机：通过 configure-tailscale-pwa.bat 输出的 HTTPS Tailscale URL 访问 /freestyle
REM
REM PWA 功能：
REM - 复用完整桌面端前端
REM - 支持添加到主屏幕（iOS/Android）
REM - 更新代码后启动时自动重新构建
REM ====================================
setlocal
cd /d "%~dp0"

set "NODE_HOME=C:\Program Files\nodejs"

if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

set "PYTHON_CMD="
if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
  "%LocalAppData%\Programs\Python\Python313\python.exe" -c "from pydantic_settings import BaseSettings; from dotenv import load_dotenv" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python313\python.exe"
)
if not defined PYTHON_CMD (
  python -c "from pydantic_settings import BaseSettings; from dotenv import load_dotenv" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo [ERROR] No usable Python runtime was found.
  echo Install dependencies with: python -m pip install -r apps\api\requirements.txt
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found.
  pause
  exit /b 1
)

"%PYTHON_CMD%" "%~dp0tools\pwa_server.py" --build %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] PWA startup failed. See logs\pwa-api.log and logs\pwa-build.log
  pause
)
exit /b %EXIT_CODE%
