@echo off
rem GSX mirror auto-seed launcher for the Windows scheduled task.
rem Self-locating via %~dp0 so the file content stays pure ASCII
rem (cmd parses batch files in the ANSI codepage; UTF-8 comments break it).
rem If the proxy or Node path changes, update them here only.
set "NODE_USE_ENV_PROXY=1"
set "HTTPS_PROXY=http://127.0.0.1:7897"
set "HTTP_PROXY=http://127.0.0.1:7897"
cd /d "%~dp0..\.."
"D:\Program Files\nodejs\node.exe" "tools\gsx-mirror\auto-seed.mjs"
