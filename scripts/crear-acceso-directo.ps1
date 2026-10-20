$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$lanzador = Join-Path $PSScriptRoot 'lanzador.ps1'
$shell = New-Object -ComObject WScript.Shell
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Crear-Acceso($carpeta) {
  $ruta = Join-Path $carpeta 'Bitácora.lnk'
  # No sustituye el acceso de una instalación de escritorio que siga existiendo.
  if (Test-Path $ruta) {
    $destino = $shell.CreateShortcut($ruta).TargetPath
    if ($destino -ne $powershell -and (Test-Path $destino)) {
      Write-Output "Se conserva $ruta porque abre $destino"
      return
    }
  }
  $acceso = $shell.CreateShortcut($ruta)
  $acceso.TargetPath = $powershell
  $acceso.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$lanzador`""
  $acceso.WorkingDirectory = $raiz
  $acceso.IconLocation = "$(Join-Path $raiz 'public\favicon.ico'),0"
  $acceso.WindowStyle = 7
  $acceso.Save()
  Write-Output "Acceso directo creado en $carpeta"
}

Crear-Acceso ([Environment]::GetFolderPath('Desktop'))
Crear-Acceso ([Environment]::GetFolderPath('Programs'))
