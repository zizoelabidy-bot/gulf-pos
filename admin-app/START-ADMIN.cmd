@echo off
setlocal
cd /d "%~dp0.."
if not defined GULF_LICENSE_KEYS_DIR (
  echo GULF_LICENSE_KEYS_DIR must point to your restricted production key directory.
  echo The application will open in registry-only mode.
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Install repository dependencies first with npm ci.
  exit /b 1
)
"node_modules\electron\dist\electron.exe" "%CD%\admin-app\main.cjs"
