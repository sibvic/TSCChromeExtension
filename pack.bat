@echo off
setlocal
cd /d "%~dp0"

if not exist dist mkdir dist
if exist dist\trade-script-converter.zip del /f dist\trade-script-converter.zip

tar -a -c -f dist\trade-script-converter.zip manifest.json background.js config.js content.js page-bridge.js sidepanel.html sidepanel.css sidepanel.js icons
if errorlevel 1 (
  echo Failed to pack the extension.
  exit /b 1
)

echo %cd%\dist\trade-script-converter.zip
