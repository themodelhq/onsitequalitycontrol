@echo off
echo ==========================================
echo  OnsiteQC - Local Backend (port 3001)
echo ==========================================
echo.

REM Check Node is installed
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org ^(v22 LTS^)
    pause
    exit /b 1
)

REM Install dependencies if node_modules is missing
if not exist "node_modules" (
    echo Installing dependencies...
    call pnpm install
    if errorlevel 1 (
        echo pnpm not found, trying npm...
        call npm install
    )
)

REM Build if dist is missing
if not exist "dist\index.js" (
    echo Building project...
    call pnpm run build 2>nul || npm run build
)

echo.
echo Starting server on http://localhost:3001
echo Keep this window open while using the app.
echo Press Ctrl+C to stop.
echo.

set PORT=3001
set NODE_ENV=production
node dist\index.js
pause
