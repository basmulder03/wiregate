#Requires -Version 5.1
<#
.SYNOPSIS
  WireGate interactive installer for Windows.
.DESCRIPTION
  Downloads the latest WireGate release, installs the binary, optionally installs
  WireGuard via winget, and registers WireGate as a Windows service.
.EXAMPLE
  irm https://raw.githubusercontent.com/basmulder03/wiregate/main/install.ps1 | iex
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo     = 'basmulder03/wiregate'
$ApiBase  = "https://api.github.com/repos/$Repo"

# ── Colours ──────────────────────────────────────────────────────────────────
function Write-Info    { param($Msg) Write-Host "[wiregate] $Msg" -ForegroundColor Cyan   }
function Write-Success { param($Msg) Write-Host "[wiregate] $Msg" -ForegroundColor Green  }
function Write-Warn    { param($Msg) Write-Host "[wiregate] $Msg" -ForegroundColor Yellow }
function Write-Err     { param($Msg) Write-Host "[wiregate] ERROR: $Msg" -ForegroundColor Red; exit 1 }

function Read-Input {
  param([string]$Prompt, [string]$Default = '')
  $display = if ($Default) { "$Prompt [$Default]: " } else { "${Prompt}: " }
  $value = Read-Host $display
  if ([string]::IsNullOrWhiteSpace($value)) { $Default } else { $value }
}

# ── Banner ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  WireGate — WireGuard management UI" -ForegroundColor Cyan
Write-Host ""

# ── Latest version ───────────────────────────────────────────────────────────
Write-Info "Fetching latest release..."
try {
  $release = Invoke-RestMethod "$ApiBase/releases/latest"
  $latestVersion = $release.tag_name
} catch {
  Write-Err "Could not fetch release info. Check https://github.com/$Repo/releases"
}
Write-Info "Latest version: $latestVersion"

$versionInput = Read-Input -Prompt "Install version" -Default $latestVersion
if (-not $versionInput.StartsWith('v')) { $versionInput = "v$versionInput" }

# ── Architecture ─────────────────────────────────────────────────────────────
$arch = if ([Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
} else {
  Write-Err "32-bit Windows is not supported."
}

# ── Install directory ─────────────────────────────────────────────────────────
$defaultDir = Join-Path $env:ProgramFiles "WireGate"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $defaultDir = Join-Path $env:LOCALAPPDATA "WireGate"
}

$installDir = Read-Input -Prompt "Install directory" -Default $defaultDir
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# ── Download ──────────────────────────────────────────────────────────────────
$versionClean = $versionInput.TrimStart('v')
$archive      = "wiregate_${versionClean}_windows_${arch}.zip"
$url          = "https://github.com/$Repo/releases/download/$versionInput/$archive"
$tmp          = Join-Path $env:TEMP "wiregate_install_$([System.IO.Path]::GetRandomFileName())"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Info "Downloading $archive..."
$archivePath = Join-Path $tmp $archive
Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing

Write-Info "Extracting..."
Expand-Archive -Path $archivePath -DestinationPath $tmp -Force
$binaryName   = 'wiregate.exe'
$binarySource = Join-Path $tmp $binaryName
$binaryDest   = Join-Path $installDir $binaryName
Copy-Item $binarySource $binaryDest -Force

Remove-Item $tmp -Recurse -Force
Write-Success "Binary installed → $binaryDest"

# ── Add to PATH ───────────────────────────────────────────────────────────────
$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($currentPath -notlike "*$installDir*") {
  [Environment]::SetEnvironmentVariable('PATH', "$currentPath;$installDir", 'User')
  Write-Info "Added $installDir to user PATH (restart your shell to apply)"
}

# ── WireGuard ─────────────────────────────────────────────────────────────────
$wgFound = $null -ne (Get-Command 'wg' -ErrorAction SilentlyContinue)
if (-not $wgFound) {
  $installWg = Read-Input -Prompt "WireGuard CLI not found. Install via winget? [Y/n]" -Default 'Y'
  if ($installWg -match '^[Yy]') {
    if (Get-Command 'winget' -ErrorAction SilentlyContinue) {
      Write-Info "Installing WireGuard via winget..."
      winget install --id WireGuard.WireGuard -e --silent
      Write-Success "WireGuard installed."
    } else {
      Write-Warn "winget not available. Download WireGuard from https://www.wireguard.com/install/"
    }
  }
}

# ── Windows Service ───────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
  $installSvc = Read-Input -Prompt "Register WireGate as a Windows service? [Y/n]" -Default 'Y'
  if ($installSvc -match '^[Yy]') {
    $port    = Read-Input -Prompt "Port to listen on" -Default '8080'
    $iface   = Read-Input -Prompt "WireGuard interface name" -Default 'wg0'
    $dataDir = Join-Path $env:ProgramData 'WireGate'
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

    $jwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })

    $svcName = 'WireGate'
    $existing = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    if ($existing) {
      Stop-Service $svcName -Force -ErrorAction SilentlyContinue
      sc.exe delete $svcName | Out-Null
    }

    # Use NSSM if available, otherwise sc.exe + registry env vars
    if (Get-Command 'nssm' -ErrorAction SilentlyContinue) {
      Write-Info "Registering service via NSSM..."
      nssm install $svcName $binaryDest
      nssm set $svcName AppEnvironmentExtra `
        "WIREGATE_SERVER_PORT=$port" `
        "WIREGATE_WIREGUARD_INTERFACE=$iface" `
        "WIREGATE_DATABASE_DSN=$dataDir\wiregate.db" `
        "WIREGATE_SERVER_JWT_SECRET=$jwtSecret"
      nssm start $svcName
    } else {
      Write-Info "Registering service via sc.exe..."
      sc.exe create $svcName binPath= "`"$binaryDest`"" start= auto | Out-Null

      # Inject all four environment variables into the service's registry key.
      # Windows services read HKLM:\SYSTEM\CurrentControlSet\Services\<name>\Environment.
      $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$svcName\Environment"
      New-Item -Path $regPath -Force | Out-Null
      $envVars = @(
        "WIREGATE_SERVER_PORT=$port",
        "WIREGATE_WIREGUARD_INTERFACE=$iface",
        "WIREGATE_DATABASE_DSN=$dataDir\wiregate.db",
        "WIREGATE_SERVER_JWT_SECRET=$jwtSecret"
      )
      Set-ItemProperty -Path $regPath -Name '(Default)' -Value $envVars -Type MultiString

      sc.exe start $svcName | Out-Null
      Write-Info "Environment variables written to service registry key: $regPath"
    }

    Write-Success "Service '$svcName' started. Access WireGate at http://localhost:$port"
  }
} else {
  Write-Warn "Not running as Administrator — skipping service registration."
  Write-Info "To register as a service, re-run this script as Administrator."
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Success "WireGate $versionInput installed successfully!"
Write-Host ""
Write-Host "  Run manually:  $binaryDest" -ForegroundColor White
Write-Host "  Documentation: https://github.com/$Repo" -ForegroundColor White
Write-Host ""
