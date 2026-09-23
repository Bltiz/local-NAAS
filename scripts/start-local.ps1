# Starts Local NAS on this Windows PC, sharing a folder you choose.
# Run it through "Start Local NAS.bat". Add -Setup to change the folder or password.
param([switch]$Setup)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path $PSScriptRoot -Parent
Set-Location $AppDir
$ConfigPath = Join-Path $AppDir 'local-nas.config.json'
$Host.UI.RawUI.WindowTitle = 'Local NAS'

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Magenta }
function Fail($message) { Write-Host "`n$message" -ForegroundColor Red; exit 1 }

function Read-Secret($prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# --- Node.js -----------------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js isn't installed. Install it by running this in PowerShell, then open this launcher again:`n`n    winget install OpenJS.NodeJS.LTS"
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { Fail "Node.js $major is too old. Update it with:  winget upgrade OpenJS.NodeJS.LTS" }

# --- Settings (first run, or -Setup) ----------------------------------------
$config = $null
if (Test-Path $ConfigPath) { $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json }

if ($Setup -or -not $config) {
  Step 'Set up Local NAS'
  Write-Host 'Pick the folder to share (for example your Projects folder). Your files stay where they are.'
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Choose the folder Local NAS should share'
  $dialog.ShowNewFolderButton = $true
  if ($config -and $config.folder) { $dialog.SelectedPath = $config.folder } else { $dialog.SelectedPath = [Environment]::GetFolderPath('UserProfile') }
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Fail 'No folder chosen. Run the launcher again when you are ready.' }
  $folder = $dialog.SelectedPath
  Write-Host "Sharing: $folder" -ForegroundColor Green

  do {
    $pw = Read-Secret 'Choose a password for signing in (at least 8 characters)'
    $pw2 = Read-Secret 'Type it again'
    if ($pw -ne $pw2) { Write-Host "They don't match. Try again." -ForegroundColor Yellow }
    elseif ($pw.Length -lt 8) { Write-Host 'Use at least 8 characters.' -ForegroundColor Yellow }
  } while ($pw -ne $pw2 -or $pw.Length -lt 8)

  $defaultName = "$env:USERNAME's PC"
  $name = Read-Host "Name for this PC [$defaultName]"
  if (-not $name) { $name = $defaultName }

  $config = [pscustomobject]@{ folder = $folder; password = $pw; name = $name; port = 43214 }
  $config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
}

if (-not (Test-Path $config.folder)) { Fail "The shared folder isn't available: $($config.folder)`nConnect the drive, or run 'Start Local NAS.bat -Setup' to pick another folder." }

# --- Install and build when needed ------------------------------------------
$lock = Join-Path $AppDir 'package-lock.json'
$installed = Join-Path (Join-Path $AppDir 'node_modules') '.package-lock.json'
if (-not (Test-Path $installed) -or (Get-Item -Force $lock).LastWriteTime -gt (Get-Item -Force $installed).LastWriteTime) {
  Step 'Installing (first run or after an update, takes a minute)'
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'Install failed. Check your internet connection and try again.' }
}

$buildId = Join-Path (Join-Path $AppDir '.next') 'BUILD_ID'
$needsBuild = -not (Test-Path $buildId)
if (-not $needsBuild) {
  $builtAt = (Get-Item -Force $buildId).LastWriteTime
  $sources = @('app', 'components', 'lib', 'public', 'proxy.ts', 'instrumentation.ts', 'package.json', 'next.config.ts') | Where-Object { Test-Path $_ }
  $newer = Get-ChildItem -Path $sources -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $builtAt } | Select-Object -First 1
  if ($newer) { $needsBuild = $true }
}
if ($needsBuild) {
  Step 'Building the app (only after an update)'
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail 'Build failed. Send a screenshot of the error above.' }
}

# --- Start -------------------------------------------------------------------
$systemDir = Join-Path $config.folder '.nas-system'
New-Item -ItemType Directory -Force -Path $systemDir | Out-Null
attrib +h "$systemDir" 2>$null | Out-Null

$env:NAS_MODE = 'local'
$env:UPLOAD_DIR = $config.folder
$env:NAS_PASSWORD = $config.password
$env:NAS_NAME = $config.name
$env:PORT = [string]$config.port
$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'

$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|VirtualBox|VMware|Hyper-V|Bluetooth' } |
    Select-Object -ExpandProperty IPAddress
} catch {}

Write-Host ''
Write-Host '  Local NAS is starting' -ForegroundColor Magenta
Write-Host "  Sharing:     $($config.folder)"
Write-Host "  On this PC:  http://localhost:$($config.port)" -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "  On laptop:   http://${ip}:$($config.port)" -ForegroundColor Green }
Write-Host ''
Write-Host '  If Windows asks about network access for Node.js, allow it on Private networks.' -ForegroundColor Yellow
Write-Host '  Keep this window open. Close it (or press Ctrl+C) to stop Local NAS.'
Write-Host ''

Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 4; Start-Process 'http://localhost:$($config.port)'"
& node ([IO.Path]::Combine($AppDir, 'node_modules', 'next', 'dist', 'bin', 'next')) start -p $config.port -H 0.0.0.0
