@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-events.ps1"
echo.
pause
endlocal
