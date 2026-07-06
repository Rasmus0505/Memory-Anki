$ErrorActionPreference = "SilentlyContinue"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startScript = Join-Path $repoRoot "start-pwa-hidden.ps1"
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $startScript, "--configure-serve") -WorkingDirectory $repoRoot -WindowStyle Hidden
