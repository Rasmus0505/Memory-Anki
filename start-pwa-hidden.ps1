$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $repoRoot "logs"
$logPath = Join-Path $logDir "pwa-startup.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-StartupLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logPath -Value "[$timestamp] $Message"
}

function Resolve-PythonRuntime {
  $python313 = Join-Path $env:LocalAppData "Programs\Python\Python313\python.exe"
  $candidates = @()
  if (Test-Path $python313) { $candidates += $python313 }
  $candidates += "python"

  foreach ($candidate in $candidates) {
    try {
      & $candidate -c "from pydantic_settings import BaseSettings; from dotenv import load_dotenv" *> $null
      if ($LASTEXITCODE -eq 0) { return $candidate }
    } catch {
      continue
    }
  }
  throw "No usable Python runtime was found. Install dependencies with: python -m pip install -r apps\api\requirements.txt"
}

try {
  Set-Location $repoRoot
  $nodeHome = "C:\Program Files\nodejs"
  if (Test-Path (Join-Path $nodeHome "node.exe")) {
    $env:Path = "$nodeHome;$env:Path"
  }
  $python = Resolve-PythonRuntime
  Write-StartupLog "Starting PWA with $python $($args -join ' ')"
  & $python (Join-Path $repoRoot "tools\pwa_server.py") --build @args 2>&1 |
    ForEach-Object {
      Add-Content -Path $logPath -Value $_
      Write-Output $_
    }
  $exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
  Write-StartupLog "PWA process exited with code $exitCode"
  exit $exitCode
} catch {
  Write-StartupLog "ERROR: $($_.Exception.Message)"
  exit 1
}
