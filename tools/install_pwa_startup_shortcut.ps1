$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "Memory Anki PWA.lnk"
$scriptPath = Join-Path $repoRoot "tools\start_pwa_scheduled.ps1"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = Join-Path $repoRoot "apps\web\public\favicon.svg"
$shortcut.Description = "Start Memory Anki mobile PWA server"
$shortcut.Save()

Write-Host "Installed startup shortcut:"
Write-Host $shortcutPath
