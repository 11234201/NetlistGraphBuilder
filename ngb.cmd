@echo off
setlocal DisableDelayedExpansion
set "NGB_LAUNCHER_CMD=1"
set "NGB_LAUNCHER_PY="
rem Do not CALL a host, rebuild %*, or change directory: all alter user arguments.
rem Only native executables are candidates; .cmd shims would replace this batch.
if not defined NGB_RUNTIME goto auto
set NGB_RUNTIME | "%SystemRoot%\System32\findstr.exe" /I /X /C:"NGB_RUNTIME=auto" >nul
if not errorlevel 1 goto auto
set NGB_RUNTIME | "%SystemRoot%\System32\findstr.exe" /I /X /C:"NGB_RUNTIME=node" >nul
if not errorlevel 1 goto node
set NGB_RUNTIME | "%SystemRoot%\System32\findstr.exe" /I /X /C:"NGB_RUNTIME=python" >nul
if not errorlevel 1 goto python
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher_log.ps1" invalid
exit /b 2

:auto
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>nul
if not errorlevel 1 goto run_node
goto python

:node
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>nul
if not errorlevel 1 goto run_node
goto missing

:python
py.exe -3 -c "import sys, http.server, socket, socketserver, threading, concurrent.futures, multiprocessing.connection; sys.exit(0 if sys.version_info >= (3, 6) else 1)" >nul 2>nul
if not errorlevel 1 goto run_py
python3.exe -c "import sys, http.server, socket, socketserver, threading, concurrent.futures, multiprocessing.connection; sys.exit(0 if sys.version_info >= (3, 6) else 1)" >nul 2>nul
if not errorlevel 1 goto run_python3
python.exe -c "import sys, http.server, socket, socketserver, threading, concurrent.futures, multiprocessing.connection; sys.exit(0 if sys.version_info >= (3, 6) else 1)" >nul 2>nul
if not errorlevel 1 goto run_python
goto missing

:run_node
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher_log.ps1" node
node.exe "%~dp0tools\serve.mjs" %*
exit /b %errorlevel%

:run_py
set "NGB_LAUNCHER_PY=1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher_log.ps1" python
py.exe -3 -u "%~dp0tools\serve.py" %*
exit /b %errorlevel%

:run_python3
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher_log.ps1" python
python3.exe -u "%~dp0tools\serve.py" %*
exit /b %errorlevel%

:run_python
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher_log.ps1" python
python.exe -u "%~dp0tools\serve.py" %*
exit /b %errorlevel%

:missing
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher_log.ps1" missing
exit /b 1
