$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python313 = Join-Path $env:LocalAppData "Programs\Python\Python313\python.exe"
if (Test-Path $python313) {
  $python = $python313
} else {
  $python = "python"
}

Set-Location $repoRoot
& $python (Join-Path $repoRoot "tools\pwa_server.py") --build @args
