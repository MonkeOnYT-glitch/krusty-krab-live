@echo off
rem Stops the Krusty Krab LIVE server (only the node process listening on port 7777).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:7777 .*LISTENING"') do taskkill /pid %%p >nul 2>nul && echo Stopped server (pid %%p)
