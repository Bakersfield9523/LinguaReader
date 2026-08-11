@echo off
title LinguaReader Launcher
setlocal enabledelayedexpansion

echo.
echo   +--------------------------------------------+
echo   ^|    LinguaReader - Book Reading Platform     ^|
echo   +--------------------------------------------+
echo.

REM ---- 1. Locate Node.js ----
set "NODE="
set "NPM="
set "NPX="

if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
    set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe"
    set "NPM=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\npm.cmd"
    set "NPX=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\npx.cmd"
    echo [OK] Node.js v22.22.2 - managed
)

if not defined NODE (
    where node >nul 2>&1
    if !errorlevel! equ 0 (
        set "NODE=node"
        set "NPM=npm"
        set "NPX=npx"
        echo [OK] Node.js - system PATH
    ) else (
        echo [FAIL] Node.js not found. Install from https://nodejs.org/
        pause
        exit /b 1
    )
)

REM ---- 2. Enter app directory ----
cd /d "%~dp0app"
if errorlevel 1 (
    echo [FAIL] Cannot enter app directory: "%~dp0app"
    pause
    exit /b 1
)

REM ---- 3. Install dependencies if missing ----
if not exist "node_modules\" (
    echo.
    echo [SETUP] Installing dependencies - may take 1-3 min...
    echo.
    call "%NPM%" install --prefer-offline
    if !errorlevel! neq 0 (
        echo.
        echo [FAIL] npm install failed. Check network and retry.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] node_modules ready
)

REM ---- 4. Init database if missing ----
if not exist "data\lingua.db" (
    echo.
    echo [SETUP] Initializing SQLite database...
    call "%NPX%" drizzle-kit push
    if !errorlevel! neq 0 (
        echo [FAIL] Database init failed
        pause
        exit /b 1
    )
    echo [OK] Database ready
) else (
    echo [OK] Database ready
)

REM ---- 5. Launch dev server ----
echo.
echo ===============================================
echo   Starting LinguaReader...
echo.
echo   Frontend : http://localhost:3000
echo   API      : http://localhost:3000/api/trpc
echo.
echo   Press Ctrl+C to stop
echo ===============================================
echo.

call "%NPX%" vite

pause
