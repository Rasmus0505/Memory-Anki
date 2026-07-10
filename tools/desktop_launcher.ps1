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
    $exitCode = Invoke-MemoryAnkiPython -Python $python -Arguments @($script)
    if ($exitCode -ne 0) {
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.MessageBox]::Show(
        "Desktop startup failed.`n`nPrimary diagnostic: logs\last-launch-error.log`nDetailed logs: logs\desktop-launch.log, logs\pwa-api.log and logs\runtime-migrate.log.",
        "Memory Anki Desktop Startup Failed",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
      ) | Out-Null
    }
    exit $exitCode
  }

  $script = Join-Path $repoRoot "tools\dev_server.py"
  exit (Invoke-MemoryAnkiPython -Python $python -Arguments @($script, "--stop"))
} catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      $_.Exception.Message,
      "Memory Anki Desktop Startup Failed",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
  }
  Write-Error ($_ | Out-String)
  exit 1
}
