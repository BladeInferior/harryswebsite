@echo off
cd /d "%~dp0"

echo Starting Stream Counter server...
start "Stream Counter Server" cmd /k node server.js

timeout /t 2 /nobreak >nul
start "" http://localhost:4747/adminhub/counter.html
