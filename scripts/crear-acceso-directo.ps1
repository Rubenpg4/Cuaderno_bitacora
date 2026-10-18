$ErrorActionPreference = 'Stop'
$lanzador = Join-Path $PSScriptRoot 'lanzador.ps1'
$escritorio = [Environment]::GetFolderPath('Desktop')

$acceso = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $escritorio 'Bitácora.lnk'))
$acceso.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$acceso.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$lanzador`""
$acceso.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$acceso.IconLocation = "$(Join-Path (Split-Path -Parent $PSScriptRoot) 'public\favicon.ico'),0"
$acceso.WindowStyle = 7
$acceso.Save()
Write-Output "Acceso directo creado en $escritorio"
