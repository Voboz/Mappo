@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Mappo - server locale
echo ============================================
echo.

rem Nota: dentro le virgolette non servono i caret prima delle pipe; aggiungerli
rem fa arrivare "^|" a PowerShell e la query fallisce.
for /f %%i in ('powershell -NoProfile -Command "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; if ($r) { (Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress }"') do set "LANIP=%%i"

echo Sul PC:        http://localhost:8080
if defined LANIP echo Dal telefono:  http://%LANIP%:8080   (stessa rete Wi-Fi)
echo.
echo Premi CTRL+C per fermare il server.
echo.

rem Apre il browser solo quando il server è quasi certamente in ascolto.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080'"

python -m http.server 8080
if errorlevel 1 (
  echo.
  echo Python non trovato. Installa Python 3 oppure usa un altro server statico.
  pause
)
