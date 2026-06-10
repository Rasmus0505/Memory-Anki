Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-OptionalEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$DefaultValue
    )
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'User')
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'Machine')
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }
    return $value
}

function Get-OptionalEnvValueOrNull {
    param([Parameter(Mandatory = $true)][string]$Name)
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'User')
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'Machine')
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $null
    }
    return $value
}

function Get-DefaultAppHome {
    if ($env:MEMORY_ANKI_HOME) {
        return [System.IO.Path]::GetFullPath($env:MEMORY_ANKI_HOME)
    }
    if ($env:LOCALAPPDATA) {
        return (Join-Path $env:LOCALAPPDATA 'MemoryAnki')
    }
    return (Join-Path $HOME 'AppData\Local\MemoryAnki')
}

function ConvertTo-HashtableValue {
    param([Parameter(Mandatory = $true)][object]$Value)

    if ($null -eq $Value) {
        return $null
    }
    if (
        $Value -is [string] -or
        $Value -is [char] -or
        $Value -is [bool] -or
        $Value -is [byte] -or
        $Value -is [int16] -or
        $Value -is [int32] -or
        $Value -is [int64] -or
        $Value -is [uint16] -or
        $Value -is [uint32] -or
        $Value -is [uint64] -or
        $Value -is [single] -or
        $Value -is [double] -or
        $Value -is [decimal] -or
        $Value -is [datetime]
    ) {
        return $Value
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $Value.Keys) {
            $result[[string]$key] = ConvertTo-HashtableValue -Value $Value[$key]
        }
        return $result
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(ConvertTo-HashtableValue -Value $item)
        }
        return $items
    }
    $properties = $Value | Get-Member -MemberType NoteProperty, Property -ErrorAction SilentlyContinue
    if ($properties) {
        $result = @{}
        foreach ($property in $properties) {
            $result[$property.Name] = ConvertTo-HashtableValue -Value $Value.$($property.Name)
        }
        return $result
    }
    return $Value
}

function Get-JsonObject {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return @{}
    }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return @{}
        }
        $parsed = $raw | ConvertFrom-Json
        if ($null -eq $parsed) {
            return @{}
        }
        return (ConvertTo-HashtableValue -Value $parsed)
    } catch {
        return @{}
    }
}

function Set-JsonObject {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Data
    )
    Ensure-Directory -Path (Split-Path $Path -Parent)
    $json = $Data | ConvertTo-Json -Depth 20
    Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
}

function Get-HashtableValueOrDefault {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Table,
        [Parameter(Mandatory = $true)][string]$Key,
        $DefaultValue = $null
    )
    if ($Table.ContainsKey($Key)) {
        return $Table[$Key]
    }
    return $DefaultValue
}

function Get-StorageLayout {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $layoutPath = Join-Path $RepoRoot 'apps\api\storage-layout.json'
    $payload = Get-JsonObject -Path $layoutPath
    $managedItems = @()
    foreach ($item in (Get-HashtableValueOrDefault -Table $payload -Key 'managed_items' @())) {
        if ($item -isnot [hashtable]) {
            continue
        }
        $managedItems += @{
            key = [string](Get-HashtableValueOrDefault -Table $item -Key 'key' '')
            relative_path = [string](Get-HashtableValueOrDefault -Table $item -Key 'relative_path' '')
            kind = [string](Get-HashtableValueOrDefault -Table $item -Key 'kind' '')
            required = [bool](Get-HashtableValueOrDefault -Table $item -Key 'required' $false)
            backup = [bool](Get-HashtableValueOrDefault -Table $item -Key 'backup' $false)
        }
    }
    return @{
        storage_mode = [string](Get-HashtableValueOrDefault -Table $payload -Key 'storage_mode' 'user_app_home')
        managed_items = $managedItems
    }
}

function Invoke-GitCapture {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git.exe'
    $psi.WorkingDirectory = $RepoPath
    $psi.Arguments = [string]::Join(' ', $Arguments)
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            return $null
        }
        return (($stdout + [Environment]::NewLine + $stderr).Trim())
    } finally {
        $process.Dispose()
    }
}

function Get-RepoHeadCommit {
    param([Parameter(Mandatory = $true)][string]$RepoPath)
    $commit = Invoke-GitCapture -RepoPath $RepoPath -Arguments @('rev-parse', 'HEAD')
    if ([string]::IsNullOrWhiteSpace($commit)) {
        return $null
    }
    return $commit.Trim()
}

function New-StartupBackup {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    Ensure-Directory -Path $Config.FullBackupsDir
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $folder = Join-Path $Config.FullBackupsDir "$timestamp-$Reason"
    Ensure-Directory -Path $folder

    $includedItems = @()
    foreach ($item in $Config.StorageLayout.managed_items) {
        if (-not $item.backup) {
            continue
        }
        $relativePath = [string]$item.relative_path
        if ([string]::IsNullOrWhiteSpace($relativePath)) {
            continue
        }
        $sourcePath = Join-Path $Config.AppHome $relativePath
        $destinationPath = Join-Path $folder $relativePath
        $destinationParent = Split-Path $destinationPath -Parent
        if (-not [string]::IsNullOrWhiteSpace($destinationParent)) {
            Ensure-Directory -Path $destinationParent
        }

        $sourceExists = Test-Path -LiteralPath $sourcePath
        if ($sourceExists) {
            if ($item.kind -eq 'directory') {
                Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
            } else {
                Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
            }
        } elseif ($item.kind -eq 'directory' -and $item.required) {
            Ensure-Directory -Path $destinationPath
        }

        $includedItems += [ordered]@{
            key = $item.key
            relative_path = $relativePath
            kind = $item.kind
            required = [bool]$item.required
            source_exists = [bool]$sourceExists
            included = [bool]($sourceExists -or ($item.kind -eq 'directory' -and $item.required))
        }
    }

    $manifest = [ordered]@{
        version = 3
        reason = $Reason
        created_at = (Get-Date).ToString('s')
        storage_mode = $Config.StorageLayout.storage_mode
        app_home = $Config.AppHome
        included_items = $includedItems
    }
    Set-Content -LiteralPath (Join-Path $folder 'manifest.json') -Value ($manifest | ConvertTo-Json -Depth 5) -Encoding UTF8
    return $folder
}

function Get-ListeningPidsByPort {
    param([Parameter(Mandatory = $true)][int]$Port)
    $pids = @()
    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    } catch {
        $netstatLines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
        foreach ($line in $netstatLines) {
            $parts = ($line.ToString() -split '\s+') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            if ($parts.Count -ge 5) {
                $pids += [int]$parts[-1]
            }
        }
        $pids = $pids | Select-Object -Unique
    }
    return @($pids)
}

function Get-ChildProcessIdsRecursive {
    param([Parameter(Mandatory = $true)][int]$ParentProcessId)

    $childIds = @()
    try {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentProcessId" -ErrorAction Stop)
    } catch {
        return @()
    }

    foreach ($child in $children) {
        $childIds += [int]$child.ProcessId
        $childIds += @(Get-ChildProcessIdsRecursive -ParentProcessId ([int]$child.ProcessId))
    }

    return @($childIds | Select-Object -Unique)
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $childIds = @(Get-ChildProcessIdsRecursive -ParentProcessId $ProcessId)
    foreach ($childProcessId in $childIds) {
        try {
            Stop-Process -Id $childProcessId -Force -ErrorAction Stop
        } catch {
        }
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
    }
}

function Get-MemoryAnkiProcessIds {
    param([Parameter(Mandatory = $true)][hashtable]$Config)

    $matches = @()
    try {
        $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    } catch {
        return @()
    }

    foreach ($process in $processes) {
        $commandLine = [string]$process.CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine)) {
            continue
        }
        if (
            $commandLine -like '*memory_anki.app.main:app*' -or
            $commandLine -like '*MEMORY_ANKI_RUNTIME_SNAPSHOT*' -or
            $commandLine -like '*npx vite --host 127.0.0.1 --port*' -or
            $commandLine -like '*MemoryAnki\switcher-logs*' -or
            $commandLine -like "*$($Config.RuntimeRoot)*"
        ) {
            $matches += [int]$process.ProcessId
        }
    }

    return @($matches | Select-Object -Unique)
}

function Wait-ForPortsReleased {
    param(
        [Parameter(Mandatory = $true)][int[]]$Ports,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $remainingPorts = @()
        foreach ($port in $Ports) {
            if (@(Get-ListeningPidsByPort -Port $port).Count -gt 0) {
                $remainingPorts += $port
            }
        }
        if ($remainingPorts.Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for ports to close: $($Ports -join ', ')"
}

function Stop-MemoryAnkiServices {
    param([Parameter(Mandatory = $true)][hashtable]$Config)

    $processIds = @()
    $processIds += @(Get-MemoryAnkiProcessIds -Config $Config)
    $processIds += @(Get-ListeningPidsByPort -Port $Config.ApiPort)
    $processIds += @(Get-ListeningPidsByPort -Port $Config.LegacyWebPort)
    $processIds = @($processIds | Where-Object { $_ -and $_ -ne $PID } | Select-Object -Unique)

    foreach ($processId in $processIds) {
        Stop-ProcessTree -ProcessId $processId
    }

    Wait-ForPortsReleased -Ports @($Config.ApiPort, $Config.LegacyWebPort)
}

function Invoke-WebBuild {
    param([Parameter(Mandatory = $true)][string]$WebDir)

    Push-Location $WebDir
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend build failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$ParentPath,
        [Parameter(Mandatory = $true)][string]$ChildPath
    )
    $parent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd('\')
    $child = [System.IO.Path]::GetFullPath($ChildPath).TrimEnd('\')
    if (-not ($child -eq $parent -or $child.StartsWith("$parent\", [System.StringComparison]::OrdinalIgnoreCase))) {
        throw "Refusing to operate outside runtime root: $ChildPath"
    }
}

function Copy-DirectoryFresh {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Missing required path: $Source"
    }
    Ensure-Directory -Path (Split-Path $Destination -Parent)
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function New-RuntimeSnapshot {
    param([Parameter(Mandatory = $true)][hashtable]$Config)

    Ensure-Directory -Path $Config.RuntimeRoot
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $nextRuntime = Join-Path $Config.RuntimeRoot "next-$timestamp"
    $previousRuntime = Join-Path $Config.RuntimeRoot "previous-$timestamp"

    Assert-ChildPath -ParentPath $Config.RuntimeRoot -ChildPath $nextRuntime
    if (Test-Path -LiteralPath $nextRuntime) {
        Remove-Item -LiteralPath $nextRuntime -Recurse -Force
    }

    $apiSource = Join-Path $Config.RepoRoot 'apps\api'
    $webDistSource = Join-Path $Config.RepoRoot 'apps\web\dist'
    $apiDestination = Join-Path $nextRuntime 'apps\api'
    $webDestination = Join-Path $nextRuntime 'apps\web\dist'

    Ensure-Directory -Path $nextRuntime
    Copy-DirectoryFresh -Source (Join-Path $apiSource 'src') -Destination (Join-Path $apiDestination 'src')
    Copy-DirectoryFresh -Source (Join-Path $apiSource 'alembic') -Destination (Join-Path $apiDestination 'alembic')
    Copy-Item -LiteralPath (Join-Path $apiSource 'pyproject.toml') -Destination $apiDestination -Force
    Copy-Item -LiteralPath (Join-Path $apiSource 'requirements.txt') -Destination $apiDestination -Force
    Copy-Item -LiteralPath (Join-Path $apiSource 'runtime-contract.json') -Destination $apiDestination -Force
    Copy-Item -LiteralPath (Join-Path $apiSource 'storage-layout.json') -Destination $apiDestination -Force
    if (Test-Path -LiteralPath (Join-Path $apiSource 'alembic.ini')) {
        Copy-Item -LiteralPath (Join-Path $apiSource 'alembic.ini') -Destination $apiDestination -Force
    }
    Copy-DirectoryFresh -Source $webDistSource -Destination $webDestination

    if (Test-Path -LiteralPath $Config.CurrentRuntime) {
        Assert-ChildPath -ParentPath $Config.RuntimeRoot -ChildPath $previousRuntime
        Move-Item -LiteralPath $Config.CurrentRuntime -Destination $previousRuntime -Force
    }
    Move-Item -LiteralPath $nextRuntime -Destination $Config.CurrentRuntime -Force

    return $Config.CurrentRuntime
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 40
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for service: $Url"
}

function New-EnvironmentAssignments {
    param([Parameter(Mandatory = $true)][hashtable]$Variables)

    $lines = @()
    foreach ($key in $Variables.Keys) {
        $value = [string]$Variables[$key]
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }
        $escapedValue = $value.Replace("'", "''")
        $lines += "`$env:$key = '$escapedValue'"
    }
    return $lines
}

function Start-MemoryAnkiApi {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][string]$SnapshotPath
    )

    Ensure-Directory -Path $Config.LogsDir
    $apiLog = Join-Path $Config.LogsDir 'production-api.log'
    Set-Content -LiteralPath $apiLog -Value '' -Encoding UTF8

    $apiDir = Join-Path $SnapshotPath 'apps\api'
    $webDist = Join-Path $SnapshotPath 'apps\web\dist'
    $commit = Get-RepoHeadCommit -RepoPath $Config.RepoRoot
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.WorkingDirectory = $apiDir
    $psi.Arguments = "/c python -m uvicorn --app-dir src memory_anki.app.main:app --host $($Config.ApiHost) --port $($Config.ApiPort) >> `"$apiLog`" 2>&1"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['MEMORY_ANKI_HOME'] = $Config.AppHome
    $psi.EnvironmentVariables['MEMORY_ANKI_CHANNEL'] = 'production'
    $psi.EnvironmentVariables['MEMORY_ANKI_WEB_DIST'] = $webDist
    $psi.EnvironmentVariables['MEMORY_ANKI_RUNTIME_SNAPSHOT'] = $SnapshotPath
    if ($commit) {
        $psi.EnvironmentVariables['MEMORY_ANKI_GIT_COMMIT'] = $commit
    }
    foreach ($name in @(
        'DASHSCOPE_API_KEY',
        'DASHSCOPE_BASE_URL',
        'DASHSCOPE_TTS_BASE_URL',
        'DASHSCOPE_ASR_MODEL',
        'DASHSCOPE_VISION_MODEL',
        'DASHSCOPE_TEXT_MODEL',
        'ENGLISH_TRANSLATION_MODEL'
    )) {
        $value = Get-OptionalEnvValueOrNull -Name $name
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $psi.EnvironmentVariables[$name] = $value
        }
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    try {
        [void]$process.Start()
    } finally {
        $process.Dispose()
    }
    Wait-ForHttp -Url $Config.BrowserUrl
}

function Open-AppBrowser {
    param([Parameter(Mandatory = $true)][hashtable]$Config)
    if ((Get-OptionalEnvValue -Name 'MEMORY_ANKI_OPEN_BROWSER' -DefaultValue '1') -eq '0') {
        return
    }
    Start-Process $Config.BrowserUrl | Out-Null
}

$appHome = Get-DefaultAppHome
$apiPort = [int](Get-OptionalEnvValue -Name 'API_PORT' -DefaultValue '8012')
$legacyWebPort = [int](Get-OptionalEnvValue -Name 'WEB_PORT' -DefaultValue '5173')
$runtimeRoot = Join-Path $appHome 'runtime'
$config = [ordered]@{
    RepoRoot = $repoRoot
    AppHome = $appHome
    DataDir = (Join-Path $appHome 'data')
    FullBackupsDir = (Join-Path $appHome 'data\backups\full')
    RuntimeRoot = $runtimeRoot
    CurrentRuntime = (Join-Path $runtimeRoot 'current')
    LogsDir = (Join-Path $appHome 'logs')
    ApiHost = '127.0.0.1'
    ApiPort = $apiPort
    LegacyWebPort = $legacyWebPort
    BrowserUrl = "http://127.0.0.1:$apiPort/"
    StorageLayout = (Get-StorageLayout -RepoRoot $repoRoot)
}

Ensure-Directory -Path $config.AppHome
Ensure-Directory -Path $config.DataDir

Write-Host "Stopping existing Memory Anki processes..."
Stop-MemoryAnkiServices -Config $config

Write-Host "Creating startup backup..."
$backupPath = New-StartupBackup -Config $config -Reason 'before-start'

Write-Host "Building frontend..."
Invoke-WebBuild -WebDir (Join-Path $repoRoot 'apps\web')

Write-Host "Creating runtime snapshot..."
$snapshotPath = New-RuntimeSnapshot -Config $config

Write-Host "Starting Memory Anki..."
Start-MemoryAnkiApi -Config $config -SnapshotPath $snapshotPath
Open-AppBrowser -Config $config

$state = [ordered]@{
    version = 1
    started_at = (Get-Date).ToString('o')
    repo_root = $repoRoot
    runtime_snapshot = $snapshotPath
    backup_path = $backupPath
    browser_url = $config.BrowserUrl
    commit = (Get-RepoHeadCommit -RepoPath $repoRoot)
}
Set-JsonObject -Path (Join-Path $config.AppHome 'startup-state.json') -Data $state

Write-Host "Memory Anki is running."
Write-Host "URL: $($config.BrowserUrl)"
Write-Host "Runtime snapshot: $snapshotPath"
Write-Host "Startup backup: $backupPath"
