param(
  [switch]$AttachOnly,
  [switch]$VisibleBackend,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$createdNew = $false
$trayMutex = [System.Threading.Mutex]::new($true, "Local\MemoryAnkiPwaTray", [ref]$createdNew)
if (-not $createdNew) {
  $trayMutex.Dispose()
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$launcher = Join-Path $repoRoot "tools\pwa_launcher.ps1"
$diagnosticRunner = Join-Path $repoRoot "tools\run_with_diagnostics.ps1"
$logDir = Join-Path $repoRoot "logs"
$startupLog = Join-Path $logDir "pwa-startup.log"
$localUrl = "http://127.0.0.1:8012/freestyle"
$healthUrl = "http://127.0.0.1:8012/api/v1/runtime-health"
$script:launcherProcess = $null
$script:stopping = $false
$script:readyNotified = $false
$script:launcherExitObservedAt = $null
$restartGraceSeconds = 180

function Show-PwaError {
  param([string]$Message)
  [System.Windows.Forms.MessageBox]::Show(
    "$Message`n`nLog: $startupLog",
    "Memory Anki PWA Startup Failed",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

function Invoke-PwaControl {
  param([string]$Action)
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", ('"{0}"' -f $diagnosticRunner),
    "-Name", "pwa-control-$($Action.ToLowerInvariant())",
    "-ScriptPath", ('"{0}"' -f $launcher),
    $Action
  )
  $control = Start-Process -FilePath "powershell.exe" -ArgumentList $args -WindowStyle Hidden -PassThru -Wait
  return $control.ExitCode
}

function Test-PwaReady {
  try {
    $request = [System.Net.WebRequest]::Create($healthUrl)
    $request.Timeout = 1000
    $response = $request.GetResponse()
    try {
      return $response.StatusCode -eq 200
    } finally {
      $response.Dispose()
    }
  } catch {
    return $false
  }
}

function New-MemoryAnkiTrayIcon {
  $bitmap = New-Object System.Drawing.Bitmap(32, 32)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(2, 6, 23))
    $card = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(248, 250, 252))
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(52, 211, 153))
    try {
      $graphics.FillEllipse($background, 1, 1, 30, 30)
      $graphics.FillRectangle($card, 8, 7, 17, 20)
      $graphics.FillEllipse($accent, 21, 3, 8, 8)
      $linePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(2, 6, 23), 2)
      try {
        $graphics.DrawLine($linePen, 12, 13, 21, 13)
        $graphics.DrawLine($linePen, 12, 18, 19, 18)
        $graphics.DrawLine($linePen, 12, 23, 21, 23)
      } finally {
        $linePen.Dispose()
      }
    } finally {
      $background.Dispose()
      $card.Dispose()
      $accent.Dispose()
    }
    $handle = $bitmap.GetHicon()
    return [System.Drawing.Icon]::FromHandle($handle).Clone()
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  if (-not $AttachOnly) {
    $startArgs = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", ('"{0}"' -f $diagnosticRunner),
      "-Name", "pwa-service",
      "-ScriptPath", ('"{0}"' -f $launcher),
      "Start"
    ) + @($RemainingArgs)
    if (-not $VisibleBackend) {
      $startArgs = @("-WindowStyle", "Hidden") + $startArgs + @("-Hidden")
      $script:launcherProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $startArgs -WindowStyle Hidden -PassThru
    } else {
      $script:launcherProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $startArgs -PassThru
    }
  }

  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $openItem = $menu.Items.Add("Open Memory Anki")
  $openItem.Add_Click({ Start-Process $localUrl })
  $logsItem = $menu.Items.Add("Open startup log")
  $logsItem.Add_Click({ Start-Process "explorer.exe" -ArgumentList "/select,`"$startupLog`"" })
  [void]$menu.Items.Add("-")
  $script:stopItem = $menu.Items.Add("Stop shared service")
  $script:stopItem.Add_Click({
    $script:stopping = $true
    [void](Invoke-PwaControl -Action "Stop")
    $script:notifyIcon.Text = "Memory Anki PWA stopped"
    $script:stopItem.Enabled = $false
  })
  $exitItem = $menu.Items.Add("Exit tray")
  $exitItem.Add_Click({
    $script:stopping = $true
    $script:notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::ExitThread()
  })

  $script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
  $script:notifyIcon.Icon = New-MemoryAnkiTrayIcon
  $script:notifyIcon.Text = "Memory Anki PWA starting"
  $script:notifyIcon.ContextMenuStrip = $menu
  $script:notifyIcon.Visible = $true
  $script:notifyIcon.Add_DoubleClick({ Start-Process $localUrl })

  $script:timer = New-Object System.Windows.Forms.Timer
  $script:timer.Interval = 1000
  $script:timer.Add_Tick({
    $ready = Test-PwaReady
    if ($ready) {
      $script:notifyIcon.Text = "Memory Anki PWA running"
      $script:stopItem.Enabled = $true
      $script:launcherExitObservedAt = $null
      if (-not $script:readyNotified) {
        $script:readyNotified = $true
        $script:notifyIcon.ShowBalloonTip(3000, "Memory Anki", "Shared service is ready.", [System.Windows.Forms.ToolTipIcon]::Info)
      }
    }
    $launcherExited = $script:launcherProcess -and $script:launcherProcess.HasExited
    if (-not $script:stopping -and $launcherExited -and -not $ready) {
      if ($script:readyNotified) {
        $script:notifyIcon.Text = "Memory Anki stopped"
        $script:stopItem.Enabled = $false
        return
      }
      if ($null -eq $script:launcherExitObservedAt) {
        $script:launcherExitObservedAt = Get-Date
        $script:notifyIcon.Text = "Memory Anki PWA restarting"
      }
      $elapsed = ((Get-Date) - $script:launcherExitObservedAt).TotalSeconds
      if ($elapsed -ge $restartGraceSeconds) {
        $script:timer.Stop()
        $script:notifyIcon.Text = "Memory Anki PWA failed"
        Show-PwaError "Shared service did not recover within $restartGraceSeconds seconds."
        [System.Windows.Forms.Application]::ExitThread()
      }
    }
  })
  $script:timer.Start()

  [System.Windows.Forms.Application]::Run()
  $script:timer.Stop()
  $script:timer.Dispose()
  $script:notifyIcon.Visible = $false
  $script:notifyIcon.Dispose()
  $menu.Dispose()
} catch {
  try {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $startupLog -Value "[$timestamp] Tray error: $($_ | Out-String)"
  } catch {
  }
  Show-PwaError $_.Exception.Message
  exit 1
} finally {
  if ($script:stopping -and $script:launcherProcess -and -not $script:launcherProcess.HasExited) {
    $script:launcherProcess.WaitForExit(5000)
  }
  $trayMutex.ReleaseMutex()
  $trayMutex.Dispose()
}
