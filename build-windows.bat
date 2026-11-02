@echo off
setlocal EnableExtensions
title FakePay - сборка установщика Windows
cd /d "%~dp0"

echo ==============================================
echo   FakePay POS - сборка установщика (Inno Setup)
echo ==============================================
echo.

rem ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 goto :no_node
where npm >nul 2>nul
if errorlevel 1 goto :no_node
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [1/5] Node.js найден: %NODEV%

rem ---------- 2. Встроенный сервер ----------
echo [2/5] Подготовка встроенного сервера...
if not exist "desktop\relay" mkdir "desktop\relay"
copy /y "server\server.js" "desktop\relay\server.js" >nul
if errorlevel 1 goto :fail

rem ---------- 3. Сборка приложения ----------
echo [3/5] Установка зависимостей и упаковка приложения.
echo       Первый раз это занимает несколько минут - Electron скачивается из интернета.
cd /d "%~dp0desktop"
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail
call npm run pack
if errorlevel 1 goto :fail
cd /d "%~dp0"
if not exist "desktop\build\FakePay POS-win32-x64\FakePay POS.exe" goto :fail

rem ---------- 4. Inno Setup ----------
call :find_iscc
if defined ISCC goto :have_iscc
echo [4/5] Inno Setup не найден. Пробую установить через winget...
where winget >nul 2>nul
if errorlevel 1 goto :no_inno
winget install -e --id JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements
call :find_iscc
if defined ISCC goto :have_iscc
goto :no_inno

:have_iscc
echo [4/5] Inno Setup: %ISCC%

rem ---------- 5. Компиляция установщика ----------
echo [5/5] Сборка установщика...
"%ISCC%" "installer\FakePay.iss"
if errorlevel 1 goto :fail
if not exist "dist\FakePay-POS-Setup.exe" goto :fail

echo.
echo ==============================================
echo   ГОТОВО!
echo   Установщик: %~dp0dist\FakePay-POS-Setup.exe
echo ==============================================
echo.
set "RUNIT="
set /p RUNIT=Запустить установщик сейчас? [Y/N]:
if /i "%RUNIT%"=="Y" start "" "%~dp0dist\FakePay-POS-Setup.exe"
goto :end

:find_iscc
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
exit /b 0

:no_node
echo.
echo ОШИБКА: не найден Node.js.
echo Установите Node.js LTS с https://nodejs.org и запустите этот файл снова.
goto :end

:no_inno
echo.
echo ОШИБКА: не найден Inno Setup 6.
echo Скачайте и установите его с https://jrsoftware.org/isdl.php и запустите этот файл снова.
goto :end

:fail
echo.
echo ОШИБКА: сборка не удалась. Смотрите сообщения выше.

:end
echo.
pause
endlocal
