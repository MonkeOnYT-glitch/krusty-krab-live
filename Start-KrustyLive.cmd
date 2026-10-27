@echo off
rem Opens the Krusty Krab LIVE desktop app (it starts the server itself).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Installing dependencies... & call npm install || (pause & exit /b 1))
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
echo Control panel opens in the Krusty Krab LIVE window.
echo OBS overlay:   http://localhost:7777/overlay.html  (Browser source 1080x1920)
