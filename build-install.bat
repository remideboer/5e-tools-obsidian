@echo off
setlocal
cd /d "%~dp0"

set "FIVEETOOLS_DEV_VAULTS=C:\Users\remid\Documents\Obsidian Vault"
if not exist "%FIVEETOOLS_DEV_VAULTS%\.obsidian\" (
  echo Vault not found: %FIVEETOOLS_DEV_VAULTS%
  exit /b 1
)

call npm run build:obsidian
exit /b %ERRORLEVEL%
