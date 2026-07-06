$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startScript = Join-Path $repoRoot "start-pwa-hidden.ps1"
$logDir = Join-Path $repoRoot "logs"
$logPath = Join-Path $logDir "pwa-startup.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-StartupLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logPath -Value "[$timestamp] $Message"
}

try {
  $powershell = Join-Path $PSHOME "powershell.exe"
  if (-not (Test-Path $powershell)) {
    $powershell = "powershell.exe"
  }
  Write-StartupLog "Launching hidden PWA startup wrapper."
  $process = Start-Process -FilePath $powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $startScript, "--configure-serve") -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
  Write-StartupLog "Started hidden wrapper PID $($process.Id)."
} catch {
  Write-StartupLog "ERROR launching hidden wrapper: $($_.Exception.Message)"
  exit 1
}
