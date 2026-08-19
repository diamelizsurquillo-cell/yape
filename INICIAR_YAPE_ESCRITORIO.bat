@echo off
title YAPE MONITOR - RECEPTOR DE ESCRITORIO
color 5f
echo ========================================================
echo        YAPE NOTIFICATION MONITOR - ESCRITORIO
echo ========================================================
echo.
echo Iniciando receptor de pagos en segundo plano...
echo.

cd /d "%~dp0"
node desktop/yape-desktop.js

pause
