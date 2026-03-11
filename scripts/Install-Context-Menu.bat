@echo off
title Antigravity Mobile - Context Menu Manager
:: Antigravity Mobile — Right-click context menu installer (Windows)
:: Right-click folder → "Open with Antigravity + MobileWork (Debug)"

cd /d "%~dp0\.."

:menu
cls
echo ===================================================
echo   Antigravity Mobile - Right-Click Menu Installer
echo ===================================================
echo.
echo This tool manages the "Open with Antigravity + MobileWork"
echo option in the Windows Explorer right-click menu.
echo.
echo FEATURES:
echo   - Add/Remove the option when right-clicking on folders
echo   - Clicking it launches Antigravity Mobile at that folder
echo   - Opens Terminal and runs the launcher
echo.
echo REQUIREMENTS:
echo   - Node.js must be installed and in PATH
echo   - Administrator privileges (UAC prompt will appear)
echo.
echo ===================================================
echo.
echo Choose an option:
echo   [1] Install  - Add right-click menu
echo   [2] Remove   - Remove right-click menu
echo   [3] Restart Explorer (to apply changes)
echo   [4] Backup   - Export registry before changes
echo   [5] Exit
echo.

set /p "choice=Enter your choice (1-5): "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto remove
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto backup
if "%choice%"=="5" goto end
echo [ERROR] Invalid choice.
pause
goto menu

:backup
echo.
echo [BACKUP] Exporting registry keys...
for /f %%a in ('powershell -command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "TIMESTAMP=%%a"

if not exist "%~dp0..\registry" mkdir "%~dp0..\registry"

set "BACKUP_FILE=%~dp0..\registry\context_menu_backup_%TIMESTAMP%.reg"
reg export "HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityMobile" "%BACKUP_FILE%" /y 2>nul
reg export "HKEY_CLASSES_ROOT\Directory\shell\AntigravityMobile" "%BACKUP_FILE%" /y 2>nul
if exist "%BACKUP_FILE%" (
    echo [SUCCESS] Backup saved to: %BACKUP_FILE%
) else (
    echo [INFO] No Antigravity context menu found to back up.
)
echo.
pause
goto menu

:install
echo.
echo [INSTALL] Adding registry entries...

set "PROJECT_DIR=%~dp0.."
set "ICON_PATH=%PROJECT_DIR%\public\favicon.ico"

:: Create command to run Antigravity Mobile at the selected folder
:: For folder background (right-click empty space inside a folder)
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityMobile\" /ve /d \"Open with Antigravity + MobileWork\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityMobile\" /v Icon /d \"cmd.exe\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityMobile\command\" /ve /d \"cmd /k cd /d \"\"%%V\"\" ^& npx tsx \"\"%PROJECT_DIR%\server\src\launcher.ts\"\"\" /f' -Verb RunAs -Wait" 2>nul

:: For folder (right-click directly on a folder)
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityMobile\" /ve /d \"Open with Antigravity + MobileWork\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityMobile\" /v Icon /d \"cmd.exe\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityMobile\command\" /ve /d \"cmd /k cd /d \"\"%%1\"\" ^& npx tsx \"\"%PROJECT_DIR%\server\src\launcher.ts\"\"\" /f' -Verb RunAs -Wait" 2>nul

echo.
echo [SUCCESS] Context menu installed!
echo.
echo   Usage: Right-click any folder
echo          → "Open with Antigravity + MobileWork"
echo.
pause
goto menu

:restart
echo.
echo [RESTART] Restarting Windows Explorer...
taskkill /f /im explorer.exe >nul 2>nul
start explorer.exe
echo [SUCCESS] Explorer restarted.
echo.
pause
goto menu

:remove
echo.
echo [REMOVE] Deleting registry entries...

powershell -Command "Start-Process reg -ArgumentList 'delete \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityMobile\" /f' -Verb RunAs -Wait" 2>nul
powershell -Command "Start-Process reg -ArgumentList 'delete \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityMobile\" /f' -Verb RunAs -Wait" 2>nul

echo.
echo [SUCCESS] Context menu removed!
echo.
pause
goto menu

:end
echo [EXIT] No changes made.
exit /b
