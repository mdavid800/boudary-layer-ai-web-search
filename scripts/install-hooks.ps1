[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  git config core.hooksPath .githooks
  Write-Host "Configured Git hooks path to .githooks" -ForegroundColor Green
} finally {
  Pop-Location
}