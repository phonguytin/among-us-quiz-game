@echo off
chcp 65001 >nul
title amongquiz launcher
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo [LOI] Khong tim thay Node.js / npm. Cai Node.js tai https://nodejs.org roi chay lai.
    pause
    exit /b 1
)

if not exist "backend\node_modules" (
    echo Dang cai thu vien cho backend...
    call npm --prefix backend install || goto :fail
)
if not exist "frontend\node_modules" (
    echo Dang cai thu vien cho frontend...
    call npm --prefix frontend install || goto :fail
)

echo Dang chay backend  (http://localhost:3000)...
start "amongquiz Backend" cmd /k "cd /d ""%~dp0backend"" && npm run dev"

echo Dang chay frontend (http://localhost:8080)...
start "amongquiz Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev-nolog"

echo Doi server khoi dong...
timeout /t 5 /nobreak >nul
start "" http://localhost:8080

echo.
echo Game dang chay. Dong 2 cua so " Backend" va "Frontend" de tat.
timeout /t 5 >nul
exit /b 0

:fail
echo [LOI] Cai thu vien that bai.
pause
exit /b 1
