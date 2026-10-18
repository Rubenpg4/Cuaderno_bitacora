# Abre Bitácora en una ventana de Brave y mantiene el servicio solo mientras esa ventana siga abierta.
# Por defecto usa la versión compilada; con -Dev arranca `pnpm dev` (Vite en 127.0.0.1:1420).
param([switch]$Dev)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$raiz = Split-Path -Parent $PSScriptRoot
$brave = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
$perfil = Join-Path $env:LOCALAPPDATA 'Bitacora\brave-perfil'
$datos = if ($env:BITACORA_DATA_DIR) { $env:BITACORA_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Bitacora' }

function Avisar($mensaje) {
  [System.Windows.Forms.MessageBox]::Show($mensaje, 'Bitácora', 'OK', 'Warning') | Out-Null
}

function Abrir-Ventana($url) {
  Start-Process -FilePath $brave -PassThru -ArgumentList @(
    "--app=$url", "--user-data-dir=`"$perfil`"", '--no-first-run', '--no-default-browser-check'
  )
}

# Devuelve el PID del servicio si ya hay uno vivo para esta carpeta de datos.
function Get-ServicioActivo {
  try {
    $servicio = Get-Content (Join-Path $datos 'service.lock') -Raw -ErrorAction Stop
    $proceso = Get-Process -Id ([int]$servicio) -ErrorAction Stop
    if ($proceso.ProcessName -ne 'node') { return $null }
    return $proceso.Id
  } catch { return $null }
}

function Enfocar-VentanaExistente {
  $ids = @((Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object CommandLine -match 'brave-perfil').ProcessId)
  if (-not $ids) { return $false }
  $ventana = Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
  if (-not $ventana) { return $false }
  (New-Object -ComObject WScript.Shell).AppActivate($ventana.Id) | Out-Null
  return $true
}

function Test-CompilacionAlDia {
  $salidas = 'dist\index.html', 'dist-service\server.cjs' | ForEach-Object { Join-Path $raiz $_ }
  if ($salidas | Where-Object { -not (Test-Path $_) }) { return $false }
  $compilado = ($salidas | ForEach-Object { (Get-Item $_).LastWriteTimeUtc } | Measure-Object -Minimum).Minimum
  $carpetas = 'src', 'service', 'shared', 'public' | ForEach-Object { Get-ChildItem (Join-Path $raiz $_) -Recurse -File -ErrorAction SilentlyContinue }
  # Get-Item y no Get-ChildItem -Recurse: con un archivo, este último lo buscaría también dentro de node_modules.
  $archivos = 'index.html', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml' | ForEach-Object { Get-Item (Join-Path $raiz $_) -ErrorAction SilentlyContinue }
  $fuentes = @($carpetas) + @($archivos) | Measure-Object -Property LastWriteTimeUtc -Maximum
  return $fuentes.Maximum -le $compilado
}

function Invoke-Oculto($programa, $argumentos) {
  $p = Start-Process -FilePath $programa -ArgumentList $argumentos -WorkingDirectory $raiz -WindowStyle Hidden -PassThru -Wait
  if ($p.ExitCode -ne 0) { throw "Falló: $programa $argumentos" }
}

function Iniciar-Compilado {
  # Solo compila la interfaz y el servicio; la verificación completa sigue siendo `pnpm run build`.
  if (-not (Test-CompilacionAlDia)) {
    Invoke-Oculto "$env:APPDATA\npm\pnpm.cmd" 'exec vite build'
    Invoke-Oculto 'node.exe' 'scripts/build-service.mjs'
  }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = (Get-Command node.exe).Source
  $info.Arguments = 'dist-service/server.cjs'
  $info.WorkingDirectory = $raiz
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  # El servicio se cierra de forma ordenada cuando este lanzador termina, también si muere a la fuerza.
  $info.EnvironmentVariables['BITACORA_PARENT_PID'] = [string]$PID
  $servicio = [System.Diagnostics.Process]::Start($info)
  $linea = $servicio.StandardOutput.ReadLineAsync()
  if (-not $linea.Wait(30000) -or -not $linea.Result) {
    if (-not $servicio.HasExited) { $servicio.Kill() }
    throw 'El servicio no arrancó. Puede que Bitácora ya esté abierta desde otra aplicación.'
  }
  $conexion = $linea.Result | ConvertFrom-Json
  return "http://127.0.0.1:$($conexion.port)/#session=$($conexion.token)"
}

function Iniciar-Desarrollo {
  $script:dev = Start-Process -FilePath "$env:APPDATA\npm\pnpm.cmd" -ArgumentList 'dev' `
    -WorkingDirectory $raiz -WindowStyle Hidden -PassThru
  $limite = (Get-Date).AddSeconds(90)
  while ($true) {
    $cliente = New-Object System.Net.Sockets.TcpClient
    try { if ($cliente.ConnectAsync('127.0.0.1', 1420).Wait(300)) { break } } catch {} finally { $cliente.Dispose() }
    if ($script:dev.HasExited) { throw 'pnpm dev terminó antes de estar listo.' }
    if ((Get-Date) -gt $limite) { throw 'Vite no respondió en el puerto 1420.' }
    Start-Sleep -Milliseconds 500
  }
  return 'http://127.0.0.1:1420'
}

# Un solo lanzador a la vez: un doble clic mientras el primero compila o arranca solo enfoca su ventana.
$mutex = New-Object System.Threading.Mutex($false, 'Local\Bitacora.Lanzador')
try { $propietario = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $propietario = $true }
if (-not $propietario) {
  $limite = (Get-Date).AddSeconds(180)
  while (-not (Enfocar-VentanaExistente) -and (Get-Date) -lt $limite) { Start-Sleep -Seconds 1 }
  return
}

if (Get-ServicioActivo) {
  if (-not (Enfocar-VentanaExistente)) { Avisar 'Bitácora ya está abierta en otra aplicación. Ciérrala antes de usar este acceso directo.' }
  return
}

$dev = $null
try {
  $url = if ($Dev) { Iniciar-Desarrollo } else { Iniciar-Compilado }
  # Con un perfil propio, el proceso de Brave vive mientras quede alguna ventana de la app.
  (Abrir-Ventana $url).WaitForExit()
}
catch {
  Avisar $_.Exception.Message
}
finally {
  if ($dev -and -not $dev.HasExited) { & taskkill.exe /PID $dev.Id /T /F | Out-Null }
}
