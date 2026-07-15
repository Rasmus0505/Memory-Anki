param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-zA-Z0-9_-]+$")]
  [string]$Name,

  [Parameter(Mandatory = $true)]
  [string]$ScriptPath,

  [switch]$ChildSta,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ScriptArgs
)

$ErrorActionPreference = "Stop"
$ScriptArgs = @($ScriptArgs | Where-Object { $null -ne $_ })

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$logDir = Join-Path $repoRoot "logs"
$statusDir = Join-Path $logDir "launch-status"
$launchLog = Join-Path $logDir "$Name-launch.log"
$historyLog = Join-Path $logDir "launch-history.log"
$statusPath = Join-Path $statusDir "$Name.json"
$lastStatusPath = Join-Path $logDir "last-launch-status.json"
$lastErrorPath = Join-Path $logDir "last-launch-error.log"
$startedAt = Get-Date
$launchId = "{0}-{1}-{2}" -f $startedAt.ToString("yyyyMMdd-HHmmssfff"), $PID, $Name
$tail = [System.Collections.Generic.Queue[string]]::new()
$maxTailLines = 160
$exitCode = 1
$resolvedScript = $null
$gitCommit = $null
$gitDirty = $null

New-Item -ItemType Directory -Force -Path $logDir, $statusDir | Out-Null

function Add-LaunchLine {
  param([AllowEmptyString()][string]$Line)

  Add-Content -LiteralPath $launchLog -Encoding UTF8 -Value $Line
  $tail.Enqueue($Line)
  while ($tail.Count -gt $maxTailLines) {
    [void]$tail.Dequeue()
  }
}

function Write-JsonAtomic {
  param(
    [string]$Path,
    [hashtable]$Payload
  )

  $temporaryPath = "$Path.$PID.tmp"
  $Payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function New-LaunchStatus {
  param(
    [string]$State,
    [Nullable[int]]$ResultCode,
    [Nullable[datetime]]$FinishedAt
  )

  $durationSeconds = $null
  if ($FinishedAt) {
    $durationSeconds = [math]::Round(($FinishedAt - $startedAt).TotalSeconds, 3)
  }
  return @{
    schema_version = 1
    name = $Name
    launch_id = $launchId
    state = $State
    success = if ($null -eq $ResultCode) { $null } else { $ResultCode -eq 0 }
    exit_code = $ResultCode
    started_at = $startedAt.ToString("o")
    finished_at = if ($FinishedAt) { $FinishedAt.ToString("o") } else { $null }
    duration_seconds = $durationSeconds
    computer = $env:COMPUTERNAME
    process_id = $PID
    repo_root = $repoRoot
    script = $resolvedScript
    arguments = @($ScriptArgs)
    log = $launchLog
    git_commit = $gitCommit
    git_dirty = $gitDirty
  }
}

try {
  Set-Location $repoRoot
  $resolvedScript = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ScriptPath)
  if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) {
    throw "Launcher script does not exist: $resolvedScript"
  }

  try {
    # Only short commit for diagnostics; skip `git status` (slow on large/synced trees).
    $gitCommit = (& git rev-parse --short HEAD 2>$null | Select-Object -First 1)
    $gitDirty = $null
  } catch {
    $gitCommit = $null
    $gitDirty = $null
  }

  $separator = "=" * 78
  Add-LaunchLine ""
  Add-LaunchLine $separator
  Add-LaunchLine "LAUNCH START id=$launchId"
  Add-LaunchLine "time=$($startedAt.ToString('o')) computer=$env:COMPUTERNAME pid=$PID"
  Add-LaunchLine "repo=$repoRoot"
  Add-LaunchLine "script=$resolvedScript"
  Add-LaunchLine "args=$(@($ScriptArgs) -join ' ')"
  Add-LaunchLine "git_commit=$gitCommit git_dirty=$gitDirty powershell=$($PSVersionTable.PSVersion)"
  Add-Content -LiteralPath $historyLog -Encoding UTF8 -Value "[$($startedAt.ToString('o'))] START id=$launchId name=$Name log=$launchLog"

  $runningStatus = New-LaunchStatus -State "running" -ResultCode $null -FinishedAt $null
  Write-JsonAtomic -Path $statusPath -Payload $runningStatus
  Write-JsonAtomic -Path $lastStatusPath -Payload $runningStatus

  $childArgs = @("-NoProfile")
  if ($ChildSta) {
    $childArgs += "-STA"
  }
  $childArgs += @("-ExecutionPolicy", "Bypass", "-File", $resolvedScript)
  $childArgs += @($ScriptArgs)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & powershell.exe @childArgs 2>&1 | ForEach-Object {
      $line = [string]$_
      Add-LaunchLine $line
      Write-Output $line
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
} catch {
  $exitCode = 1
  $details = ($_ | Out-String).TrimEnd()
  foreach ($line in ($details -split "`r?`n")) {
    Add-LaunchLine "WRAPPER ERROR: $line"
    Write-Error $line
  }
} finally {
  $finishedAt = Get-Date
  $state = if ($exitCode -eq 0) { "succeeded" } else { "failed" }
  Add-LaunchLine "LAUNCH END id=$launchId state=$state exit_code=$exitCode duration_seconds=$([math]::Round(($finishedAt - $startedAt).TotalSeconds, 3))"
  Add-Content -LiteralPath $historyLog -Encoding UTF8 -Value "[$($finishedAt.ToString('o'))] END id=$launchId name=$Name state=$state exit_code=$exitCode"

  $finalStatus = New-LaunchStatus -State $state -ResultCode $exitCode -FinishedAt $finishedAt
  Write-JsonAtomic -Path $statusPath -Payload $finalStatus
  Write-JsonAtomic -Path $lastStatusPath -Payload $finalStatus

  if ($exitCode -ne 0) {
    $errorHeader = @(
      "Memory Anki launch failure",
      "launch_id=$launchId",
      "name=$Name",
      "time=$($finishedAt.ToString('o'))",
      "exit_code=$exitCode",
      "script=$resolvedScript",
      "full_log=$launchLog",
      "status=$statusPath",
      "",
      "Last $maxTailLines diagnostic lines:"
    )
    @($errorHeader) + @($tail.ToArray()) | Set-Content -LiteralPath $lastErrorPath -Encoding UTF8
  }
}

exit $exitCode
