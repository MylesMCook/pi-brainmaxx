@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
set "DIST_CLI=%ROOT_DIR%\dist\src\codex-cli.js"
set "SOURCE_CLI=%ROOT_DIR%\src\codex-cli.ts"

if exist "%DIST_CLI%" (
  node "%DIST_CLI%" %*
  exit /b %ERRORLEVEL%
)

where npx >nul 2>nul
if %ERRORLEVEL% EQU 0 if exist "%SOURCE_CLI%" (
  npx --yes tsx "%SOURCE_CLI%" %*
  exit /b %ERRORLEVEL%
)

echo Brainerd runtime is missing. Rebuild the skill or reinstall the packaged copy. 1>&2
exit /b 1
