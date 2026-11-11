@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Luoghi del cuore - server locale
echo ============================================
echo.

for /f %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Select-Object -First 1).IPAddress"') do set "LANIP=%%i"

echo Sul PC:        http://localhost:8080
if defined LANIP echo Dal telefono:  http://%LANIP%:8080   (stessa rete Wi-Fi)
echo.
echo Premi CTRL+C per fermare il server.
echo.

start "" "http://localhost:8080"

python -m http.server 8080
if errorlevel 1 (
  echo.
  echo Python non trovato. Installa Python 3 oppure usa un altro server statico.
  pause
)
