@echo off
rem Nur fuer DICH als Entwickler: baut die fertige Lounge-Windows.exe (Endnutzer brauchen das nie).
rem Voraussetzung: Node.js (https://nodejs.org). Dauert beim ersten Mal ein paar Minuten.
cd /d "%~dp0"
call npm install
if errorlevel 1 goto fail
call npm run dist:win
if errorlevel 1 goto fail
if exist "..\lounge-website\downloads" copy /y "dist\Lounge-Windows.exe" "..\lounge-website\downloads\" >nul
echo.
echo Fertig: dist\Lounge-Windows.exe
pause
exit /b 0
:fail
echo.
echo Fehler beim Bauen - siehe Meldungen oben.
pause
exit /b 1
