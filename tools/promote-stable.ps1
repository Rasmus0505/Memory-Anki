[CmdletBinding()]
param(
    [string]$Commit
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'version-switcher-common.ps1')

$config = Get-VersionSwitcherConfig -RepoRoot $repoRoot
$state = Get-SwitcherState -Config $config

if ([string]::IsNullOrWhiteSpace($Commit)) {
    Assert-WorkingTreeClean -RepoPath $config.DevRepoPath -Label 'dev working tree'
    $resolvedCommit = Get-RepoHeadCommit -RepoPath $config.DevRepoPath
} else {
    $resolvedCommit = Resolve-GitCommit -RepoPath $config.DevRepoPath -Commit $Commit
}

Ensure-StableWorktree -Config $config -State $state -Commit $resolvedCommit
[void](Assert-RuntimeCompatible -RepoPath $state.stable_repo_path -Config $config)
$stableHead = Get-RepoHeadCommit -RepoPath $state.stable_repo_path

$state.dev_repo_path = $config.DevRepoPath
$state.stable_repo_path = $state.stable_repo_path
$state.stable_commit = $stableHead
$state.stable_short_commit = $stableHead.Substring(0, [Math]::Min(8, $stableHead.Length))
$state.stable_set_at = (Get-Date).ToString('o')
$state.stable_runtime_contract = Get-RuntimeContract -RepoPath $state.stable_repo_path

Save-SwitcherState -Config $config -State $state

Write-Host "Stable version now points to commit: $stableHead"
Write-Host "Stable repo: $($state.stable_repo_path)"
Write-Host "State file: $($config.SwitcherStatePath)"
