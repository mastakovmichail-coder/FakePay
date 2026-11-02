@echo off
setlocal EnableExtensions
title FakePay - загрузка проекта на GitHub
cd /d "%~dp0"

echo ==============================================
echo   FakePay - загрузка проекта на GitHub
echo   APK соберётся автоматически во вкладке Actions
echo ==============================================
echo.

where git >nul 2>nul
if errorlevel 1 goto :no_git

rem ---------- репозиторий ----------
if not exist ".git" git init
if errorlevel 1 goto :fail

git config user.name >nul 2>nul
if not errorlevel 1 goto :have_name
set "GNAME="
set /p GNAME=Ваше имя для коммитов (латиницей):
if "%GNAME%"=="" set "GNAME=FakePay"
git config user.name "%GNAME%"
:have_name

git config user.email >nul 2>nul
if not errorlevel 1 goto :have_mail
set "GMAIL="
set /p GMAIL=Ваш email для коммитов:
if "%GMAIL%"=="" set "GMAIL=fakepay@example.com"
git config user.email "%GMAIL%"
:have_mail

rem ---------- удалённый репозиторий ----------
git remote get-url origin >nul 2>nul
if not errorlevel 1 goto :have_remote

echo.
echo Создайте на github.com ПУСТОЙ репозиторий: New repository, без README и .gitignore.
echo Скопируйте его адрес, например  https://github.com/ИМЯ/fakepay.git
echo Если установлен GitHub CLI (gh), можно просто нажать Enter - репозиторий создастся сам.
echo.
set "REPO="
set /p REPO=Адрес репозитория:
if not "%REPO%"=="" goto :add_remote

where gh >nul 2>nul
if errorlevel 1 goto :no_repo
gh auth status >nul 2>nul
if errorlevel 1 gh auth login
gh repo create fakepay --private --source=. --remote=origin
if errorlevel 1 goto :fail
goto :have_remote

:add_remote
git remote add origin "%REPO%"
if errorlevel 1 goto :fail

:have_remote

rem ---------- коммит и отправка ----------
echo.
echo Подготовка файлов...
git add -A
git commit -m "FakePay: server, POS app, terminal app, APK build workflow"
git branch -M main
echo.
echo Отправка на GitHub (может открыться окно входа в браузере)...
git push -u origin main
if errorlevel 1 goto :push_fail

rem ---------- ссылка на Actions ----------
set "REMOTE="
for /f "delims=" %%r in ('git remote get-url origin') do set "REMOTE=%%r"
set "WEB=%REMOTE%"
if "%WEB:~-4%"==".git" set "WEB=%WEB:~0,-4%"

echo.
echo ==============================================
echo   ГОТОВО! Проект загружен.
echo   Сборка APK запущена автоматически (5-10 минут).
echo   Откройте вкладку Actions - выберите последний запуск Build APK -
echo   внизу, в разделе Artifacts, скачайте FakePay-Terminal-apk.
echo ==============================================
echo.
if /i "%WEB:~0,8%"=="https://" (
  echo Открываю: %WEB%/actions
  start "" "%WEB%/actions"
)
goto :end

:no_git
echo.
echo ОШИБКА: не найден Git.
echo Установите Git с https://git-scm.com/download/win и запустите этот файл снова.
goto :end

:no_repo
echo.
echo Адрес репозитория не указан, а GitHub CLI не найден. Создайте репозиторий на github.com
echo и запустите этот файл снова.
goto :end

:push_fail
echo.
echo ОШИБКА: не удалось отправить проект. Частые причины:
echo  - репозиторий не пустой (есть README): удалите его на GitHub или выполните
echo    git pull origin main --allow-unrelated-histories   и запустите файл снова;
echo  - нет прав: войдите в GitHub аккаунт, которому принадлежит репозиторий;
echo  - при использовании токена ему нужны права repo и workflow.
goto :end

:fail
echo.
echo ОШИБКА: что-то пошло не так. Смотрите сообщения выше.

:end
echo.
pause
endlocal
