@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-chrome.ps1"
if errorlevel 1 (
  echo Failed to pack the extension.
  exit /b 1
)
