$ErrorActionPreference = "Stop"

function New-MemoryAnkiPythonCandidate {
  param(
    [string]$File,
    [string[]]$Args = @()
  )
  [pscustomobject]@{
    File = $File
    Args = $Args
  }
}

function Test-MemoryAnkiPythonCandidate {
  param(
    $Candidate,
    [string]$ProbeCode = "import sys"
  )
  if (-not $Candidate -or -not $Candidate.File) {
    return $false
  }
  try {
    $probeArgs = @($Candidate.Args) + @("-c", $ProbeCode)
    & $Candidate.File @probeArgs *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Add-MemoryAnkiPythonInstallCandidates {
  param(
    [System.Collections.ArrayList]$Candidates,
    [string]$Root
  )
  if (-not $Root -or -not (Test-Path $Root)) {
    return
  }
  Get-ChildItem -LiteralPath $Root -Directory -Filter "Python*" |
    Sort-Object -Property Name -Descending |
    ForEach-Object {
      $path = Join-Path $_.FullName "python.exe"
      if (Test-Path $path) {
        [void]$Candidates.Add((New-MemoryAnkiPythonCandidate -File $path))
      }
    }
}

function Get-MemoryAnkiPythonCachePath {
  $localAppData = $env:LOCALAPPDATA
  if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE "AppData\Local"
  }
  $cacheRoot = Join-Path $localAppData "MemoryAnki"
  return Join-Path $cacheRoot "python-runtime.json"
}

function Read-MemoryAnkiPythonCache {
  $cachePath = Get-MemoryAnkiPythonCachePath
  if (-not (Test-Path -LiteralPath $cachePath)) {
    return $null
  }
  try {
    $cached = Get-Content -Raw -Encoding UTF8 -LiteralPath $cachePath | ConvertFrom-Json
    $args = @()
    if ($cached.args) {
      $args = @($cached.args | ForEach-Object { [string]$_ })
    }
    return New-MemoryAnkiPythonCandidate -File ([string]$cached.file) -Args $args
  } catch {
    return $null
  }
}

function Write-MemoryAnkiPythonCache {
  param($Candidate)
  try {
    $cachePath = Get-MemoryAnkiPythonCachePath
    $cacheDir = Split-Path -Parent $cachePath
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    [pscustomobject]@{
      file = $Candidate.File
      args = @($Candidate.Args)
    } | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath $cachePath
  } catch {
    # Runtime caching is an optimization; startup must still work if it cannot be written.
  }
}

function Resolve-MemoryAnkiPythonRuntime {
  param(
    [string]$ProbeCode = "import sys"
  )

  $candidates = [System.Collections.ArrayList]::new()

  if ($env:MEMORY_ANKI_PYTHON) {
    [void]$candidates.Add((New-MemoryAnkiPythonCandidate -File $env:MEMORY_ANKI_PYTHON))
  } else {
    $cached = Read-MemoryAnkiPythonCache
    if ($cached) {
      [void]$candidates.Add($cached)
    }
  }

  Add-MemoryAnkiPythonInstallCandidates -Candidates $candidates -Root (Join-Path $env:LocalAppData "Programs\Python")
  Add-MemoryAnkiPythonInstallCandidates -Candidates $candidates -Root (Join-Path $env:ProgramFiles "Python")

  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($versionArg in @("-3.13", "-3.12", "-3.11", "-3")) {
      [void]$candidates.Add((New-MemoryAnkiPythonCandidate -File "py" -Args @($versionArg)))
    }
  }

  if (Get-Command python -ErrorAction SilentlyContinue) {
    [void]$candidates.Add((New-MemoryAnkiPythonCandidate -File "python"))
  }

  foreach ($candidate in $candidates) {
    if (Test-MemoryAnkiPythonCandidate -Candidate $candidate -ProbeCode $ProbeCode) {
      if (-not $env:MEMORY_ANKI_PYTHON) {
        Write-MemoryAnkiPythonCache -Candidate $candidate
      }
      return $candidate
    }
  }

  throw "No usable Python runtime was found."
}

function Invoke-MemoryAnkiPython {
  param(
    $Python,
    [string[]]$Arguments
  )
  $invokeArgs = @($Python.Args) + @($Arguments)

  $quotedArgs = @($invokeArgs | ForEach-Object {
    $argument = [string]$_
    if ($argument.Length -eq 0) {
      return '""'
    }
    if ($argument -notmatch '[\s"]') {
      return $argument
    }
    $escaped = [regex]::Replace($argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
  })
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Python.File
  $startInfo.Arguments = $quotedArgs -join ' '
  $startInfo.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::Start($startInfo)
  if (-not $process) {
    throw "Failed to start Python runtime: $($Python.File)"
  }
  $process.WaitForExit()
  return $process.ExitCode
}

function Ensure-MemoryAnkiNodeRuntime {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    return
  }
  $nodeHome = Join-Path $env:ProgramFiles "nodejs"
  if (Test-Path (Join-Path $nodeHome "node.exe")) {
    $env:Path = "$nodeHome;$env:Path"
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install Node.js and make sure node.exe is available on PATH."
  }
}
