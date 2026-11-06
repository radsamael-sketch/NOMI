@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting NOMI at http://localhost:3000
node server.js
if errorlevel 1 pause
