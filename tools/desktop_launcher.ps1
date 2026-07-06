param(
  [Parameter(Position = 0)]
  [ValidateSet("Start", "Stop")]
  [string]$Action = "Start"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $repoRoot "tools\windows_runtime.ps1")

try {
  Set-Location $repoRoot
  $python = Resolve-MemoryAnkiPythonRuntime -ProbeCode "import sys"

  if ($Action -eq "Start") {
    Ensure-MemoryAnkiNodeRuntime
    $script = Join-Path $repoRoot "tools\desktop_timer.py"
    exit (Invoke-MemoryAnkiPython -Python $python -Arguments @($script))
  }

  $script = Join-Path $repoRoot "tools\dev_server.py"
  exit (Invoke-MemoryAnkiPython -Python $python -Arguments @($script, "--stop"))
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
