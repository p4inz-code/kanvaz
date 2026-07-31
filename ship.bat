@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ========================================
echo   Kanvaz Ship Script
echo  ========================================
echo.

:: ── 0. Clean stale locks ──
if exist ".git\index.lock" (
    echo  Removing stale .git/index.lock...
    del /f ".git\index.lock" 2>nul
)
if exist ".git\refs\heads\main.lock" (
    del /f ".git\refs\heads\main.lock" 2>nul
)
if exist ".git\refs\heads\master.lock" (
    del /f ".git\refs\heads\master.lock" 2>nul
)
if exist ".git\HEAD.lock" (
    del /f ".git\HEAD.lock" 2>nul
)

:: ── 1. Lint ──
echo  [1/6] Running lint...
call npm run lint
if !errorlevel! neq 0 (
    echo.
    echo  !! LINT FAILED
    goto :fail
)
echo   OK
echo.

:: ── 2. Syntax check ──
echo  [2/6] Syntax check...
node test\syntax-check.js
if !errorlevel! neq 0 (
    echo.
    echo  !! SYNTAX CHECK FAILED
    goto :fail
)
echo.

:: ── 3. Read version ──
echo  [3/6] Reading version...
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "VER=%%v"
if "%VER%"=="" (
    echo  !! Could not read version from package.json
    goto :fail
)
echo   Version: v%VER%
echo.

:: ── 4. Version consistency ──
echo  [4/6] Version consistency check...
node test\version-check.js
if !errorlevel! neq 0 (
    echo.
    echo  !! VERSION MISMATCH
    goto :fail
)
echo.

:: ── 5. Check if tag already exists ──
git tag -l "v%VER%" | findstr /r "." >nul 2>&1
if !errorlevel! equ 0 (
    echo  !! Tag v%VER% already exists. Bump the version first.
    goto :fail
)

:: ── 6. Git stage + commit + tag + push ──
echo  [5/6] Git: stage, commit, tag, push...
git add -A
if !errorlevel! neq 0 (
    echo  !! git add failed
    goto :fail
)

echo.
echo   Staged:
git status --short
echo.

git commit -m "v%VER%"
if !errorlevel! neq 0 (
    echo.
    echo  !! GIT COMMIT FAILED
    goto :fail
)

git tag "v%VER%"
if !errorlevel! neq 0 (
    echo  !! git tag failed
    goto :fail
)

git push
if !errorlevel! neq 0 (
    echo  !! git push failed
    goto :fail
)

git push --tags
if !errorlevel! neq 0 (
    echo  !! git push --tags failed
    goto :fail
)
echo.

:: ── 7. Build ──
echo  [6/6] Building Windows installer + portable...
call npm run dist
if !errorlevel! neq 0 (
    echo.
    echo  !! BUILD FAILED
    goto :fail
)

echo.
echo  ========================================
echo   v%VER% shipped!
echo  ========================================
echo.
echo   Binaries: dist\
echo   Release:  https://github.com/p4inz-code/kanvaz/releases/new?tag=v%VER%
echo.
pause
exit /b 0

:fail
echo.
echo  ========================================
echo   SHIP ABORTED — fix the error above.
echo  ========================================
pause
exit /b 1
