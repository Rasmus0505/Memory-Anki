Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$targetPath = [System.IO.Path]::GetFullPath($Path)
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$configDir = Join-Path $localAppData 'MemoryAnki'
$configPath = Join-Path $configDir 'shared-home.txt'

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
Set-Content -LiteralPath $configPath -Value $targetPath -Encoding UTF8

Write-Host "Configured shared Memory Anki runtime home:"
Write-Host "  $targetPath"
Write-Host ""
Write-Host "Config file:"
Write-Host "  $configPath"
