<#
.SYNOPSIS
  用 GitHub 私有仓库在两个设备之间传递「学习进度」快照。

.DESCRIPTION
  快照只含数据库（宫殿、题库、复习排期、做题与随心记录），不含 PDF 资料和
  英语视频，压缩后约 13MB。

  传输走 GitHub Releases（api.github.com / uploads.github.com），不依赖有时
  会断的 github.com:443，也不在仓库历史里反复堆二进制：

    release "latest"
      learning-data.zip   学习进度包（服务端 /export/progress 生成）
      snapshot.json       来源设备、时间、校验和与关键表行数

  两台设备不要同时学习；换设备前先「上传」，到另一台先「下载」。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\cross-device-sync\github-sync.ps1 push
  powershell -ExecutionPolicy Bypass -File tools\cross-device-sync\github-sync.ps1 pull
  powershell -ExecutionPolicy Bypass -File tools\cross-device-sync\github-sync.ps1 status
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'init', 'push', 'pull', 'menu')]
    [string]$Action = 'status',

    [string]$Repo = 'Rasmus0505/Memory-Anki-Data',

    [string]$SyncDir = '',

    [string]$Api = 'http://127.0.0.1:8012/api/v1',

    [string]$DatabaseFile = '',

    [switch]$Yes,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Resolve-AppHome {
    $configPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'local-config\memory-anki.local.json'
    if (Test-Path $configPath) {
        try {
            $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($config.local_app_home) { return [string]$config.local_app_home }
        } catch { }
    }
    return (Join-Path $env:LOCALAPPDATA 'MemoryAnki')
}

$appHome = Resolve-AppHome
if (-not $SyncDir) { $SyncDir = Join-Path (Split-Path $appHome -Parent) 'github-sync' }
if (-not $DatabaseFile) { $DatabaseFile = Join-Path $appHome '学习数据\memory_palace.db' }

$snapshotName = 'learning-data.zip'
$metaName = 'snapshot.json'
$stateName = 'sync-state.json'
$statePath = Join-Path $SyncDir $stateName
$metaPath = Join-Path $SyncDir $metaName
$zipPath = Join-Path $SyncDir $snapshotName
$remoteDir = Join-Path $SyncDir '.remote'

New-Item -ItemType Directory -Force -Path $SyncDir | Out-Null
New-Item -ItemType Directory -Force -Path $remoteDir | Out-Null

function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Read-State {
    if (-not (Test-Path $statePath)) { return $null }
    try { return (Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Save-State([hashtable]$Patch) {
    $state = Read-State
    if ($null -eq $state) { $state = [pscustomobject]@{} }
    foreach ($key in $Patch.Keys) {
        $state | Add-Member -NotePropertyName $key -NotePropertyValue $Patch[$key] -Force
    }
    Write-Utf8 $statePath ($state | ConvertTo-Json -Depth 5)
}

function Get-Epoch([object]$Value) {
    if (-not $Value) { return 0 }
    if ($Value -is [int] -or $Value -is [long]) { return [long]$Value }
    try { return [DateTimeOffset]::Parse("$Value").ToUnixTimeSeconds() } catch { return 0 }
}

function Format-Epoch([long]$Epoch) {
    if (-not $Epoch) { return '未知' }
    return [DateTimeOffset]::FromUnixTimeSeconds($Epoch).ToLocalTime().ToString('yyyy-MM-dd HH:mm')
}

function Invoke-Gh {
    param([string[]]$Arguments, [switch]$AllowFailure, [int]$Retries = 1)
    $output = ''
    $code = 1
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & gh @Arguments 2>&1
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        if ($code -eq 0) { break }
        if ($attempt -lt $Retries) { Start-Sleep -Seconds 2 }
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "GitHub 操作失败：$output"
    }
    return [pscustomobject]@{ Code = $code; Output = ($output -join "`n").Trim() }
}

function Invoke-Curl {
    param([string[]]$Arguments, [switch]$AllowFailure)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & curl.exe @Arguments
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "本机导出失败（curl exit $code）。"
    }
    return [pscustomobject]@{ Code = $code; Output = ($output -join "`n").Trim() }
}

function Test-Api {
    try {
        $r = Invoke-WebRequest "$Api/backups" -TimeoutSec 3 -UseBasicParsing
        return ($r.Headers['Content-Type'] -like 'application/json*')
    } catch {
        return $false
    }
}

function Assert-Api {
    if (-not (Test-Api)) {
        throw "本机 Memory Anki 没有运行（$Api 不通）。先双击 start-all.bat。"
    }
}

function Ensure-Repo {
    $view = Invoke-Gh @('repo', 'view', $Repo, '--json', 'name') -AllowFailure -Retries 3
    if ($view.Code -ne 0) {
        Write-Host "第一次使用：将在你的 GitHub 上创建私有仓库 $Repo（只有你自己能看见）。"
        if (-not $Yes) {
            $answer = Read-Host '继续？输入 y'
            if ($answer -ne 'y') { throw '已取消。' }
        }
        $created = Invoke-Gh @('repo', 'create', $Repo, '--private', '--description', 'Memory Anki 学习进度同步（私有）') -AllowFailure -Retries 2
        if ($created.Code -ne 0) { throw "创建私有仓库失败：$($created.Output)`n请先运行 gh auth login。" }
    }

    # Releases need a commit to point their tag at. A brand-new repo has none.
    $ref = Invoke-Gh @('api', "repos/$Repo/git/ref/heads/main") -AllowFailure -Retries 3
    if ($ref.Code -ne 0) {
        $readme = "# Memory Anki 学习进度`n`n这里只放跨设备同步用的快照，请勿手动修改。`n"
        $content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($readme))
        $init = Invoke-Gh @('api', '--method', 'PUT', "repos/$Repo/contents/README.md", '-f', 'message=init', '-f', "content=$content") -AllowFailure -Retries 2
        if ($init.Code -ne 0) { throw "初始化数据仓库失败：$($init.Output)" }
    }
}

function Ensure-Release {
    $view = Invoke-Gh @('release', 'view', 'latest', '--repo', $Repo) -AllowFailure -Retries 3
    if ($view.Code -eq 0) { return }
    $created = Invoke-Gh @(
        'release', 'create', 'latest',
        '--repo', $Repo,
        '--title', '学习进度快照',
        '--notes', '由 Memory Anki 自动维护；换设备时上传或下载这里的 learning-data.zip。',
        '--latest'
    ) -AllowFailure -Retries 2
    if ($created.Code -ne 0) { throw "创建快照发布页失败：$($created.Output)" }
}

function Get-RemoteMeta {
    $target = Join-Path $remoteDir $metaName
    if (Test-Path $target) { Remove-Item $target -Force }
    $download = Invoke-Gh @(
        'release', 'download', 'latest',
        '--repo', $Repo,
        '--pattern', $metaName,
        '--dir', $remoteDir,
        '--clobber'
    ) -AllowFailure -Retries 3
    if ($download.Code -ne 0 -or -not (Test-Path $target)) { return $null }
    try { return (Get-Content $target -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Read-Manifest([string]$ZipFile) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipFile)
    try {
        $entry = $zip.GetEntry('manifest.json')
        if (-not $entry) { throw '这个 zip 不是学习进度包（缺 manifest.json）。' }
        $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally {
        $zip.Dispose()
    }
    return ($text | ConvertFrom-Json)
}

function Get-LatestLocalWrite {
    $times = @()
    foreach ($suffix in @('', '-wal')) {
        $path = "$DatabaseFile$suffix"
        if (Test-Path $path) { $times += [DateTimeOffset](Get-Item $path).LastWriteTimeUtc }
    }
    if ($times.Count -eq 0) { return 0 }
    return ([long](($times | Sort-Object -Descending | Select-Object -First 1).ToUnixTimeSeconds()))
}

function Show-Status {
    Write-Host '=== 学习进度同步 ==='
    Write-Host "本机服务   : $(if (Test-Api) { '运行中' } else { '未运行，先双击 start-all.bat' })"
    $meta = Get-RemoteMeta
    if ($meta) {
        $seen = Format-Epoch (Get-Epoch $meta.epoch)
        if (-not $meta.epoch) { $seen = "$($meta.created_at)" }
        Write-Host "远端最新   : $seen  来自 $($meta.device)"
        Write-Host "              $([math]::Round($meta.size_bytes / 1MB, 1)) MB   palaces=$($meta.counts.palaces) 题=$($meta.counts.palace_quiz_questions) 复习卡=$($meta.counts.review_unit_states)"
    } else {
        Write-Host '远端最新   : 读取不到（还没有快照，或网络不通）'
    }
    $state = Read-State
    if ($state) {
        Write-Host "上次上传   : $(Format-Epoch (Get-Epoch $state.last_push_epoch))"
        Write-Host "上次下载   : $(Format-Epoch (Get-Epoch $state.last_pull_epoch))"
    }
    $localWrite = Get-LatestLocalWrite
    if ($localWrite) { Write-Host "本机数据   : 最后写入 $(Format-Epoch $localWrite)" }
}

function Invoke-Push {
    Write-Host '正在检查本机服务…'
    Assert-Api
    Write-Host '正在连接 GitHub…'
    Ensure-Repo
    Ensure-Release

    $remoteMeta = Get-RemoteMeta
    $state = Read-State
    $lastSeen = 0
    if ($state -and $state.remote_epoch) { $lastSeen = [long]$state.remote_epoch }
    $remoteEpoch = Get-Epoch $remoteMeta.epoch
    if (-not $remoteEpoch -and $remoteMeta) { $remoteEpoch = Get-Epoch $remoteMeta.created_at }
    if ($remoteMeta -and $remoteEpoch -gt $lastSeen) {
        $message = "另一台设备在 $(Format-Epoch $remoteEpoch) 上传了更新的进度（$($remoteMeta.device)）。先下载，或确认用本机覆盖它。"
        if (-not $Force) {
            Write-Host "注意：$message"
            $answer = Read-Host '确认覆盖远端？输入 y 后按回车'
            if ($answer -ne 'y') { throw '已取消。先运行 pull。' }
        }
    }

    $tmp = Join-Path $SyncDir ".$snapshotName.tmp"
    Write-Host '正在从本机导出学习进度…'
    $download = Invoke-Curl @('--silent', '--show-error', '--max-time', '900', '--output', $tmp, '--write-out', '%{http_code}', "$Api/export/progress") -AllowFailure
    $code = $download.Output.Trim()
    if ($download.Code -ne 0 -or $code -ne '200' -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1024) {
        if (Test-Path $tmp) { Remove-Item $tmp -Force }
        throw "导出失败（HTTP $code）。"
    }

    $manifest = Read-Manifest $tmp
    if (($manifest.contents -join ',') -ne 'database') {
        Remove-Item $tmp -Force
        throw '导出的包不是纯学习进度包，已停止上传。'
    }

    $hash = (Get-FileHash $tmp -Algorithm SHA256).Hash
    $size = (Get-Item $tmp).Length
    Move-Item $tmp $zipPath -Force

    $createdAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss')
    $createdEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $meta = [ordered]@{
        format_version   = $manifest.format_version
        created_at       = $createdAt
        epoch            = $createdEpoch
        device           = $env:COMPUTERNAME
        size_bytes       = $size
        sha256           = $hash
        alembic_revision = $manifest.alembic_revision
        counts           = [ordered]@{
            palaces                       = $manifest.table_counts.palaces
            palace_quiz_questions         = $manifest.table_counts.palace_quiz_questions
            review_unit_states            = $manifest.table_counts.review_unit_states
            review_unit_rating_operations = $manifest.table_counts.review_unit_rating_operations
            quiz_attempt_events           = $manifest.table_counts.quiz_attempt_events
            freestyle_round_states        = $manifest.table_counts.freestyle_round_states
        }
    }
    Write-Utf8 $metaPath ($meta | ConvertTo-Json -Depth 5)

    Write-Host '正在上传…'
    $upload = Invoke-Gh @(
        'release', 'upload', 'latest',
        $zipPath, $metaPath,
        '--repo', $Repo,
        '--clobber'
    ) -AllowFailure -Retries 2
    if ($upload.Code -ne 0) {
        throw "上传失败：$($upload.Output)`n如果提示认证失败，在终端运行 gh auth setup-git 后重试。"
    }

    Save-State -Patch @{
        last_push_epoch = $createdEpoch
        last_sync_epoch = $createdEpoch
        remote_epoch    = $createdEpoch
        last_device     = $env:COMPUTERNAME
    }

    Write-Host "已上传：$([math]::Round($size / 1MB, 1)) MB，$createdAt（$($env:COMPUTERNAME)）"
    Write-Host '换到另一台设备后，双击「下载学习进度」即可。'
}

function Invoke-Pull {
    Write-Host '正在检查本机服务…'
    Assert-Api
    Write-Host '正在连接 GitHub…'
    Ensure-Repo

    $meta = Get-RemoteMeta
    if (-not $meta) { throw '远端还没有学习进度快照，先在第一台设备上上传。' }

    Write-Host '正在下载快照…'
    $download = Invoke-Gh @(
        'release', 'download', 'latest',
        '--repo', $Repo,
        '--pattern', $snapshotName,
        '--dir', $SyncDir,
        '--clobber'
    ) -AllowFailure -Retries 3
    if ($download.Code -ne 0 -or -not (Test-Path $zipPath)) {
        throw "下载失败：$($download.Output)"
    }

    $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash
    if ($meta.sha256 -and $actual -ne $meta.sha256) {
        throw '快照校验和不一致，下载可能不完整。请重试。'
    }

    $seen = Format-Epoch (Get-Epoch $meta.epoch)
    if (-not $meta.epoch) { $seen = "$($meta.created_at)" }
    Write-Host "远端快照：$seen  来自 $($meta.device)"
    Write-Host "             palaces=$($meta.counts.palaces)  题=$($meta.counts.palace_quiz_questions)  复习卡=$($meta.counts.review_unit_states)"
    Write-Host '正在校验这份快照…'
    $previewCall = Invoke-Curl @('--silent', '--show-error', '--max-time', '900', '-X', 'POST', '-F', "file=@$zipPath;type=application/zip", "$Api/import/progress/preview") -AllowFailure
    if ($previewCall.Code -ne 0 -or -not $previewCall.Output) { throw '预览失败。' }
    $preview = $previewCall.Output | ConvertFrom-Json
    if (-not $preview.ok) { throw "快照不可用：$($preview.detail)" }
    if (-not $preview.schema_match) {
        throw "两台的程序版本不一致（快照 $($preview.manifest.alembic_revision) / 本机 $($preview.current_alembic_revision)）。先在两台设备上更新到同一版本。"
    }

    if (-not $Yes) {
        $state = Read-State
        $localWrite = Get-LatestLocalWrite
        $lastSync = 0
        if ($state -and $state.last_sync_epoch) { $lastSync = [long]$state.last_sync_epoch }
        if ($localWrite -and $lastSync -and $localWrite -gt $lastSync) {
            Write-Host "注意：本机在 $(Format-Epoch $lastSync) 之后还有学习记录，下载会用远端快照整份替换它们。"
            $answer = Read-Host '确认放弃本机这部分记录？输入 y 后按回车'
            if ($answer -ne 'y') { throw '已取消。可以先上传本机进度，再到另一台下载。' }
        } else {
            $answer = Read-Host '下载会用远端快照整份替换本机学习数据（服务端会先留 rescue 备份）。继续？输入 y 后按回车'
            if ($answer -ne 'y') { throw '已取消。' }
        }
    }

    Write-Host '正在导入…（几十秒内不要关窗口）'
    $importCall = Invoke-Curl @('--silent', '--show-error', '--max-time', '1800', '-X', 'POST', '-F', "file=@$zipPath;type=application/zip", "$Api/import/progress") -AllowFailure
    if ($importCall.Code -ne 0 -or -not $importCall.Output) { throw '导入失败。' }
    $result = $importCall.Output | ConvertFrom-Json
    if (-not $result.ok) { throw "导入失败：$($result.detail)" }

    $remoteEpoch = Get-Epoch $meta.epoch
    if (-not $remoteEpoch) { $remoteEpoch = Get-Epoch $meta.created_at }
    $pulledAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Save-State -Patch @{
        last_pull_epoch = $pulledAt
        last_sync_epoch = $pulledAt
        remote_epoch    = $remoteEpoch
        last_device     = $meta.device
    }

    Write-Host "已导入 $($result.table_counts.palaces) 个宫殿、$($result.table_counts.palace_quiz_questions) 道题的学习数据。"
    Write-Host '回到应用页面按 F5 刷新后继续学习。'
}

switch ($Action) {
    'init' {
        Ensure-Repo
        Ensure-Release
        Write-Host ''
        Write-Host '同步已经就绪。'
        Write-Host '换设备前：双击「上传学习进度」；到另一台：先「下载学习进度」再开始学。'
        Show-Status
    }
    'push' { Invoke-Push }
    'pull' { Invoke-Pull }
    'status' { Show-Status }
    'menu' {
        while ($true) {
            Write-Host ''
            Write-Host '1 上传本机学习进度'
            Write-Host '2 下载远端学习进度'
            Write-Host '3 查看同步状态'
            Write-Host '0 退出'
            $choice = Read-Host '选择'
            switch ($choice) {
                '1' { try { Invoke-Push } catch { Write-Host "失败：$($_.Exception.Message)" } }
                '2' { try { Invoke-Pull } catch { Write-Host "失败：$($_.Exception.Message)" } }
                '3' { try { Show-Status } catch { Write-Host "失败：$($_.Exception.Message)" } }
                '0' { return }
                default { Write-Host '请输入 0-3。' }
            }
        }
    }
}