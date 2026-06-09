Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Get-DefaultAppHome {
    if ($env:MEMORY_ANKI_HOME) {
        return [System.IO.Path]::GetFullPath($env:MEMORY_ANKI_HOME)
    }
    if ($env:LOCALAPPDATA) {
        return (Join-Path $env:LOCALAPPDATA 'MemoryAnki')
    }
    return (Join-Path $HOME 'AppData\Local\MemoryAnki')
}

function Get-VersionSwitcherConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    $resolvedRepoRoot = (Resolve-Path $RepoRoot).Path
    $leafName = Split-Path $resolvedRepoRoot -Leaf
    $parentDir = Split-Path $resolvedRepoRoot -Parent
    $stableRepoPath = Join-Path $parentDir "$leafName-stable"
    $appHome = Get-DefaultAppHome
    $dataDir = Join-Path $appHome 'data'
    $attachmentsDir = Join-Path $dataDir 'attachments'
    $fullBackupsDir = Join-Path $dataDir 'backups\full'
    $switcherStatePath = Join-Path $appHome 'switcher-state.json'
    $migrationStatePath = Join-Path $appHome 'migration-state.json'
    $logsDir = Join-Path $appHome 'switcher-logs'
    $apiPort = [int](Get-OptionalEnvValue -Name 'API_PORT' -DefaultValue '8012')
    $webPort = [int](Get-OptionalEnvValue -Name 'WEB_PORT' -DefaultValue '5173')
    $browserUrl = "http://localhost:$webPort"
    $dashscopeApiKey = Get-OptionalEnvValueOrNull -Name 'DASHSCOPE_API_KEY'
    $dashscopeBaseUrl = Get-OptionalEnvValueOrNull -Name 'DASHSCOPE_BASE_URL'
    $dashscopeVisionModel = Get-OptionalEnvValueOrNull -Name 'DASHSCOPE_VISION_MODEL'
    $dashscopeTextModel = Get-OptionalEnvValueOrNull -Name 'DASHSCOPE_TEXT_MODEL'
    $storageLayout = Get-StorageLayout -RepoRoot $resolvedRepoRoot

    return [ordered]@{
        RepoRoot = $resolvedRepoRoot
        DevRepoPath = $resolvedRepoRoot
        StableRepoPath = $stableRepoPath
        AppHome = $appHome
        DataDir = $dataDir
        AttachmentsDir = $attachmentsDir
        FullBackupsDir = $fullBackupsDir
        SwitcherStatePath = $switcherStatePath
        MigrationStatePath = $migrationStatePath
        LogsDir = $logsDir
        ApiHost = '127.0.0.1'
        ApiPort = $apiPort
        WebHost = '127.0.0.1'
        WebPort = $webPort
        BrowserUrl = $browserUrl
        DashscopeApiKey = $dashscopeApiKey
        DashscopeBaseUrl = $dashscopeBaseUrl
        DashscopeVisionModel = $dashscopeVisionModel
        DashscopeTextModel = $dashscopeTextModel
        StorageLayout = $storageLayout
    }
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-JsonObject {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) {
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

function Get-SwitcherState {
    param([Parameter(Mandatory = $true)][hashtable]$Config)
    $state = Get-JsonObject -Path $Config.SwitcherStatePath
    if (-not $state.ContainsKey('dev_repo_path') -or [string]::IsNullOrWhiteSpace([string]$state.dev_repo_path)) {
        $state.dev_repo_path = $Config.DevRepoPath
    }
    if (-not $state.ContainsKey('stable_repo_path') -or [string]::IsNullOrWhiteSpace([string]$state.stable_repo_path)) {
        $state.stable_repo_path = $Config.StableRepoPath
    }
    if (-not $state.ContainsKey('stable_commit')) {
        $state.stable_commit = $null
    }
    return $state
}

function Save-SwitcherState {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][hashtable]$State
    )
    Set-JsonObject -Path $Config.SwitcherStatePath -Data $State
}

function Invoke-GitCapture {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $quotedArguments = @()
    foreach ($argument in $Arguments) {
        if ($argument -match '[\s"]') {
            $escaped = $argument.Replace('"', '\"')
            $quotedArguments += ('"{0}"' -f $escaped)
        } else {
            $quotedArguments += $argument
        }
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git.exe'
    $psi.WorkingDirectory = $RepoPath
    $psi.Arguments = [string]::Join(' ', $quotedArguments)
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
        $exitCode = $process.ExitCode
    } finally {
        $process.Dispose()
    }
    $combined = (($stdout + [Environment]::NewLine + $stderr).Trim())
    if ($exitCode -ne 0) {
        throw "git $($Arguments -join ' ') failed. $combined"
    }
    return $combined
}

function Resolve-GitCommit {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string]$Commit
    )
    return (Invoke-GitCapture -RepoPath $RepoPath -Arguments @('rev-parse', '--verify', "$Commit`^{commit}")).Trim()
}

function Get-RepoHeadCommit {
    param([Parameter(Mandatory = $true)][string]$RepoPath)
    return (Invoke-GitCapture -RepoPath $RepoPath -Arguments @('rev-parse', 'HEAD')).Trim()
}

function Test-WorkingTreeClean {
    param([Parameter(Mandatory = $true)][string]$RepoPath)
    $status = Invoke-GitCapture -RepoPath $RepoPath -Arguments @('status', '--short')
    return [string]::IsNullOrWhiteSpace($status)
}

function Assert-WorkingTreeClean {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $false)][string]$Label = 'working tree'
    )
    if (-not (Test-WorkingTreeClean -RepoPath $RepoPath)) {
        throw "$Label has uncommitted changes. Commit or clean them before promoting a stable version."
    }
}

function Ensure-StableWebNodeModules {
    param(
        [Parameter(Mandatory = $true)][string]$StableRepoPath,
        [Parameter(Mandatory = $true)][string]$DevRepoPath
    )

    $devNodeModules = Join-Path $DevRepoPath 'apps\web\node_modules'
    $stableNodeModules = Join-Path $StableRepoPath 'apps\web\node_modules'

    if (-not (Test-Path $devNodeModules)) {
        throw "Dev web dependencies are missing: $devNodeModules. Install frontend dependencies in the dev repo first."
    }

    if (Test-Path $stableNodeModules) {
        return
    }

    Ensure-Directory -Path (Split-Path $stableNodeModules -Parent)
    New-Item -ItemType Junction -Path $stableNodeModules -Target $devNodeModules | Out-Null
}

function Ensure-StableWorktree {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][hashtable]$State,
        [Parameter(Mandatory = $true)][string]$Commit
    )

    $stableRepoPath = [string]$State.stable_repo_path
    if ([string]::IsNullOrWhiteSpace($stableRepoPath)) {
        $stableRepoPath = $Config.StableRepoPath
        $State.stable_repo_path = $stableRepoPath
    }

    if (-not (Test-Path $stableRepoPath)) {
        [void](Invoke-GitCapture -RepoPath $Config.DevRepoPath -Arguments @(
            '-c',
            'advice.detachedHead=false',
            'worktree',
            'add',
            '--detach',
            $stableRepoPath,
            $Commit
        ))
    } else {
        try {
            [void](Invoke-GitCapture -RepoPath $stableRepoPath -Arguments @('rev-parse', '--show-toplevel'))
        } catch {
            throw "Stable repo path exists but is not a managed git worktree: $stableRepoPath"
        }
        Assert-WorkingTreeClean -RepoPath $stableRepoPath -Label 'stable working tree'
        [void](Invoke-GitCapture -RepoPath $stableRepoPath -Arguments @(
            '-c',
            'advice.detachedHead=false',
            'checkout',
            '--detach',
            $Commit
        ))
    }

    Ensure-StableWebNodeModules -StableRepoPath $stableRepoPath -DevRepoPath $Config.DevRepoPath
}

function Get-NormalizedGeneration {
    param([object]$Value, [int]$DefaultValue = 1)
    $parsed = 0
    if ([int]::TryParse([string]$Value, [ref]$parsed)) {
        if ($parsed -gt 0) {
            return $parsed
        }
    }
    return $DefaultValue
}

function Get-RuntimeContract {
    param([Parameter(Mandatory = $true)][string]$RepoPath)
    $contractPath = Join-Path $RepoPath 'apps\api\runtime-contract.json'
    $payload = Get-JsonObject -Path $contractPath
    return [ordered]@{
        contract_path = $contractPath
        runtime_generation = Get-NormalizedGeneration -Value (Get-HashtableValueOrDefault -Table $payload -Key 'runtime_generation')
        min_supported_generation = Get-NormalizedGeneration -Value (Get-HashtableValueOrDefault -Table $payload -Key 'min_supported_generation')
        max_supported_generation = Get-NormalizedGeneration -Value (Get-HashtableValueOrDefault -Table $payload -Key 'max_supported_generation')
    }
}

function Assert-RuntimeCompatible {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][hashtable]$Config
    )

    $contract = Get-RuntimeContract -RepoPath $RepoPath
    $migrationState = Get-JsonObject -Path $Config.MigrationStatePath
    $sharedGeneration = Get-NormalizedGeneration -Value (Get-HashtableValueOrDefault -Table $migrationState -Key 'runtime_generation')

    if ($sharedGeneration -gt [int]$contract.max_supported_generation) {
        throw "Target version is incompatible with shared data. Shared generation is $sharedGeneration but target supports at most $($contract.max_supported_generation)."
    }
    if ($sharedGeneration -lt [int]$contract.min_supported_generation) {
        throw "Target version is incompatible with shared data. Shared generation is $sharedGeneration but target requires at least $($contract.min_supported_generation)."
    }
    return $contract
}

function New-SharedDataBackup {
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
        $sourceExists = Test-Path $sourcePath
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
        version = 2
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

function Get-VersionServiceProcessIds {
    param([Parameter(Mandatory = $true)][hashtable]$Config)

    $matches = @()
    $apiPattern = "memory_anki.app.main:app --host $($Config.ApiHost) --port $($Config.ApiPort)"
    $webPattern = "npx vite --host $($Config.WebHost) --port $($Config.WebPort)"

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
        if ($commandLine -like "*$apiPattern*" -or $commandLine -like "*$webPattern*") {
            $matches += [int]$process.ProcessId
        }
    }

    return @($matches | Select-Object -Unique)
}

function Wait-ForPortsReleased {
    param(
        [Parameter(Mandatory = $true)][int[]]$Ports,
        [int]$TimeoutSeconds = 15
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

function Initialize-LogFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$RetryCount = 10,
        [int]$RetryDelayMilliseconds = 300
    )

    Ensure-Directory -Path (Split-Path $Path -Parent)

    for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
        try {
            Set-Content -LiteralPath $Path -Value '' -Encoding UTF8
            return $Path
        } catch [System.IO.IOException] {
            if ($attempt -lt $RetryCount) {
                Start-Sleep -Milliseconds $RetryDelayMilliseconds
                continue
            }
        }
    }

    $directory = Split-Path $Path -Parent
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $extension = [System.IO.Path]::GetExtension($Path)
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
    $fallbackPath = Join-Path $directory "$baseName-$timestamp$extension"

    Set-Content -LiteralPath $fallbackPath -Value '' -Encoding UTF8
    return $fallbackPath
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

function Stop-VersionServices {
    param([Parameter(Mandatory = $true)][hashtable]$Config)

    $processIds = @()
    $processIds += @(Get-VersionServiceProcessIds -Config $Config)
    foreach ($port in @($Config.ApiPort, $Config.WebPort)) {
        $processIds += @(Get-ListeningPidsByPort -Port $port)
    }
    $processIds = @($processIds | Where-Object { $_ -and $_ -ne $PID } | Select-Object -Unique)

    foreach ($processId in $processIds) {
        Stop-ProcessTree -ProcessId $processId
    }

    Wait-ForPortsReleased -Ports @($Config.ApiPort, $Config.WebPort)
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 35
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

function Start-VersionServices {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][ValidateSet('dev', 'stable')][string]$Target,
        [Parameter(Mandatory = $true)][string]$Commit
    )

    Ensure-Directory -Path $Config.LogsDir

    $apiLog = Initialize-LogFile -Path (Join-Path $Config.LogsDir "$Target-api.log")
    $webLog = Initialize-LogFile -Path (Join-Path $Config.LogsDir "$Target-web.log")

    $apiDir = Join-Path $RepoPath 'apps\api'
    $webDir = Join-Path $RepoPath 'apps\web'
    if ($Target -eq 'stable') {
        Ensure-StableWebNodeModules -StableRepoPath $RepoPath -DevRepoPath $Config.DevRepoPath
    }

    $escapedAppHome = $Config.AppHome.Replace("'", "''")
    $escapedApiDir = $apiDir.Replace("'", "''")
    $escapedWebDir = $webDir.Replace("'", "''")
    $escapedCommit = $Commit.Replace("'", "''")
    $escapedTarget = $Target.Replace("'", "''")
    $escapedApiLog = $apiLog.Replace("'", "''")
    $escapedWebLog = $webLog.Replace("'", "''")
    $sharedEnvAssignments = New-EnvironmentAssignments -Variables @{
        DASHSCOPE_API_KEY = $Config.DashscopeApiKey
        DASHSCOPE_BASE_URL = $Config.DashscopeBaseUrl
        DASHSCOPE_VISION_MODEL = $Config.DashscopeVisionModel
        DASHSCOPE_TEXT_MODEL = $Config.DashscopeTextModel
    }
    $sharedEnvBlock = [string]::Join([Environment]::NewLine, $sharedEnvAssignments)

    $apiCommand = @"
`$env:MEMORY_ANKI_HOME = '$escapedAppHome'
`$env:MEMORY_ANKI_CHANNEL = '$escapedTarget'
`$env:MEMORY_ANKI_GIT_COMMIT = '$escapedCommit'
$sharedEnvBlock
Set-Location '$escapedApiDir'
python -m uvicorn --app-dir src memory_anki.app.main:app --host $($Config.ApiHost) --port $($Config.ApiPort) --reload *>> '$escapedApiLog'
"@
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-Command', $apiCommand) -WindowStyle Hidden | Out-Null

    $webCommand = @"
`$env:MEMORY_ANKI_CHANNEL = '$escapedTarget'
`$env:MEMORY_ANKI_GIT_COMMIT = '$escapedCommit'
Set-Location '$escapedWebDir'
npx vite --host $($Config.WebHost) --port $($Config.WebPort) *>> '$escapedWebLog'
"@
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-Command', $webCommand) -WindowStyle Hidden | Out-Null

    Wait-ForHttp -Url "http://$($Config.ApiHost):$($Config.ApiPort)/docs"
    Wait-ForHttp -Url $Config.BrowserUrl
}

function Open-AppBrowser {
    param([Parameter(Mandatory = $true)][hashtable]$Config)
    if ((Get-OptionalEnvValue -Name 'MEMORY_ANKI_OPEN_BROWSER' -DefaultValue '1') -eq '0') {
        return
    }
    Start-Process $Config.BrowserUrl | Out-Null
}
