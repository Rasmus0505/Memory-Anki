[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('dev', 'stable')]
    [string]$Target
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'version-switcher-common.ps1')

$config = Get-VersionSwitcherConfig -RepoRoot $repoRoot
$state = Get-SwitcherState -Config $config

if ($Target -eq 'stable') {
    if ([string]::IsNullOrWhiteSpace([string]$state.stable_commit)) {
        throw "Stable version is not configured yet. Run set-stable-current.bat or set-stable-commit.bat first."
    }
    Ensure-StableWorktree -Config $config -State $state -Commit ([string]$state.stable_commit)
    $targetRepoPath = [string]$state.stable_repo_path
} else {
    $targetRepoPath = $config.DevRepoPath
}

[void](Assert-RuntimeCompatible -RepoPath $targetRepoPath -Config $config)

Stop-VersionServices -Config $config
$backupReason = "before-switch-to-$Target"
$backupPath = New-SharedDataBackup -Config $config -Reason $backupReason
$targetCommit = Get-RepoHeadCommit -RepoPath $targetRepoPath

Start-VersionServices -Config $config -RepoPath $targetRepoPath -Target $Target -Commit $targetCommit
Open-AppBrowser -Config $config

$state.dev_repo_path = $config.DevRepoPath
$state.stable_repo_path = $state.stable_repo_path
$state.last_target = $Target
$state.last_started_commit = $targetCommit
$state.last_started_at = (Get-Date).ToString('o')
$state.last_backup_path = $backupPath
Save-SwitcherState -Config $config -State $state

Write-Host "Switched to $Target version."
Write-Host "Repo: $targetRepoPath"
Write-Host "Commit: $targetCommit"
Write-Host "Pre-switch backup: $backupPath"
