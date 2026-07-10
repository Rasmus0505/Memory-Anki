param(
  [Parameter(Position = 0)]
  [ValidateSet("Start", "Stop", "Update", "ConfigureServe", "InstallAutostart", "UninstallAutostart")]
  [string]$Action = "Start",

  [switch]$Hidden,
  [switch]$ConfigureServe,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeScript = Join-Path $repoRoot "tools\windows_runtime.ps1"
. $runtimeScript

$logDir = Join-Path $repoRoot "logs"
$startupLog = Join-Path $logDir "pwa-startup.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-StartupLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $startupLog -Value "[$timestamp] $Message"
}

function Get-LocalDeviceName {
  $configPath = Join-Path $repoRoot "local-config\memory-anki.local.json"
  if (-not (Test-Path $configPath)) {
    return $env:COMPUTERNAME
  }
  try {
    $config = Get-Content -Raw -Encoding UTF8 -Path $configPath | ConvertFrom-Json
    if ($config.device_name) {
      return [string]$config.device_name
    }
  } catch {
    Write-StartupLog "Could not read local device name: $($_.Exception.Message)"
  }
  return $env:COMPUTERNAME
}

function Resolve-PythonRuntime {
  try {
    return Resolve-MemoryAnkiPythonRuntime -ProbeCode "import sys"
  } catch {
    throw "No usable Python runtime was found. Install dependencies with: python -m pip install -r apps\api\requirements.txt"
  }
}

function Invoke-PwaServer {
  param([string[]]$ServerArgs)

  Set-Location $repoRoot
  $python = Resolve-PythonRuntime
  $serverScript = Join-Path $repoRoot "tools\pwa_server.py"
  $invokeArgs = @($python.Args) + @($serverScript) + @($ServerArgs)
  $display = "$($python.File) $($invokeArgs -join ' ')"
  Write-StartupLog "Running on $(Get-LocalDeviceName): $display"

  if ($Hidden) {
    $env:MEMORY_ANKI_VISIBLE_BACKEND = "0"
  } else {
    $env:MEMORY_ANKI_VISIBLE_BACKEND = "1"
  }

  if ($Hidden) {
    & $python.File @invokeArgs 2>&1 | ForEach-Object {
      Add-Content -Path $startupLog -Value $_
      Write-Output $_
    }
    $exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
  } else {
    & $python.File @invokeArgs
    $exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
  }

  Write-StartupLog "PWA action $Action exited with code $exitCode"
  return $exitCode
}

function Install-AutostartShortcut {
  $startupDir = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupDir "Memory Anki PWA.lnk"
  $launcherPath = Join-Path $repoRoot "tools\pwa_launcher.ps1"
  $diagnosticRunner = Join-Path $repoRoot "tools\run_with_diagnostics.ps1"

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$diagnosticRunner`" -Name pwa-autostart -ScriptPath `"$launcherPath`" Start -ConfigureServe"
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.IconLocation = Join-Path $repoRoot "apps\web\public\favicon.svg"
  $shortcut.Description = "Start Memory Anki PWA server"
  $shortcut.Save()

  Write-StartupLog "Installed startup shortcut for $(Get-LocalDeviceName): $shortcutPath"
  Write-Host "Installed startup shortcut:"
  Write-Host $shortcutPath
}

function Uninstall-AutostartShortcut {
  $startupDir = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupDir "Memory Anki PWA.lnk"
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  Write-StartupLog "Removed startup shortcut if present: $shortcutPath"
  Write-Host "Removed Memory Anki PWA startup shortcut if it existed."
}

try {
  switch ($Action) {
    "Start" {
      $serverArgs = @()
      if ($ConfigureServe) {
        $serverArgs += "--configure-serve"
      }
      $serverArgs += $RemainingArgs
      exit (Invoke-PwaServer -ServerArgs $serverArgs)
    }
    "Stop" {
      exit (Invoke-PwaServer -ServerArgs @("--stop"))
    }
    "Update" {
      exit (Invoke-PwaServer -ServerArgs @("--prepare"))
    }
    "ConfigureServe" {
      $serverArgs = @("--configure-serve", "--no-supervise") + $RemainingArgs
      exit (Invoke-PwaServer -ServerArgs $serverArgs)
    }
    "InstallAutostart" {
      Install-AutostartShortcut
      exit 0
    }
    "UninstallAutostart" {
      Uninstall-AutostartShortcut
      exit 0
    }
  }
} catch {
  Write-StartupLog "ERROR: $($_ | Out-String)"
  Write-Error ($_ | Out-String)
  exit 1
}
