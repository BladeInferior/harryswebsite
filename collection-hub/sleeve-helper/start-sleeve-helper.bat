@echo off
cd /d "%~dp0"

rem Stream Deck runs this with no window of its own, so everything the owner
rem needs to see is shown in a window opened here with "start".

netstat -ano | findstr /R /C:"127.0.0.1:5501 .*LISTENING" >nul && (
    start "Sleeve Helper" cmd /c "echo The sleeve helper is already running. & timeout /t 4 >nul"
    exit /b
)

set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Program Files\nodejs\node.exe"

start "Sleeve Helper" cmd /k ""%NODE%" server.js"
