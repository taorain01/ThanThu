@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "BUILD_SCRIPT=%~dp0scripts\build-control-app.ps1"
set "CONTROL_APP=%~dp0bin\OpenClaw Discord Bot.exe"

if not exist "%BUILD_SCRIPT%" (
    echo [ERROR] Build script not found:
    echo         %BUILD_SCRIPT%
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BUILD_SCRIPT%"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not prepare the latest OpenClaw Discord Bot controller.
    pause
    exit /b 1
)

if not exist "%CONTROL_APP%" (
    echo [ERROR] Controller was not created:
    echo         %CONTROL_APP%
    pause
    exit /b 1
)

start "" "%CONTROL_APP%"
exit /b 0
