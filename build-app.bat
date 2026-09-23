@echo off
echo ==================================
echo Local NAS - Desktop App Builder
echo ==================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo X Node.js is not installed!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo + Node.js is installed
echo.

REM Check if dependencies are installed
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Building desktop app for Windows...
echo.

call npm run electron-build-win

echo.
echo ==================================
echo Build complete!
echo ==================================
echo.
echo Your app is in the 'dist' folder
echo.
echo Next steps:
echo 1. Go to the 'dist' folder
echo 2. Run 'Local NAS Setup.exe'
echo 3. Enjoy your Local NAS app!
echo.
pause
