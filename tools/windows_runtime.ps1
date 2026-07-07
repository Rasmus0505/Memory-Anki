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

function Resolve-MemoryAnkiPythonRuntime {
  param(
    [string]$ProbeCode = "import sys"
  )

  $candidates = [System.Collections.ArrayList]::new()

  if ($env:MEMORY_ANKI_PYTHON) {
    [void]$candidates.Add((New-MemoryAnkiPythonCandidate -File $env:MEMORY_ANKI_PYTHON))
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
  & $Python.File @invokeArgs
  if ($LASTEXITCODE -ne $null) {
    return $LASTEXITCODE
  }
  return 0
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
