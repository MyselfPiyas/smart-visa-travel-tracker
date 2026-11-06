@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-local-startup.ps1"
if errorlevel 1 pause
