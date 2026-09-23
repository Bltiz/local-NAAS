# Local NAS for Windows.
#   (no switch)  Run in this window. Used by "Start Local NAS.bat".
#   -Install     First-time setup, Start menu shortcut, optional start with Windows, then the tray app.
#   -Tray        Run in the system tray with no window (what the shortcuts use).
#   -Setup       Change the shared folder, password or PC name.
#   -Uninstall   Remove the shortcuts (files and settings are kept).
param([switch]$Setup, [switch]$Tray, [switch]$Install, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$ScriptPath = $PSCommandPath
$AppDir = Split-Path $PSScriptRoot -Parent
Set-Location $AppDir
$ConfigPath = Join-Path $AppDir 'local-nas.config.json'
$IconPath = Join-Path $PSScriptRoot 'local-nas.ico'
$HiddenLauncher = Join-Path $PSScriptRoot 'launch-hidden.vbs'
$LogDir = Join-Path $AppDir 'logs'
$StartMenuLink = [IO.Path]::Combine([Environment]::GetFolderPath('Programs'), 'Local NAS.lnk')
$StartupLink = [IO.Path]::Combine([Environment]::GetFolderPath('Startup'), 'Local NAS.lnk')

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Magenta }

function Fail($message) {
  if ($Tray) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($message, 'Local NAS', 'OK', 'Error')
  } else {
    Write-Host "`n$message" -ForegroundColor Red
  }
  exit 1
}

function Read-Secret($prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function New-Shortcut($path, $description) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $link.Arguments = "`"$HiddenLauncher`""
  $link.WorkingDirectory = $AppDir
  $link.IconLocation = $IconPath
  $link.Description = $description
  $link.Save()
}

# --- Shortcuts ---------------------------------------------------------------
if ($Uninstall) {
  foreach ($link in @($StartMenuLink, $StartupLink)) { if (Test-Path $link) { Remove-Item $link -Force } }
  Write-Host 'Removed the Local NAS shortcuts. Your files and settings were not touched.' -ForegroundColor Green
  exit 0
}

# --- Node.js -----------------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js isn't installed. Install it by running this in PowerShell, then try again:`n`n    winget install OpenJS.NodeJS.LTS"
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { Fail "Node.js $major is too old. Update it with:  winget upgrade OpenJS.NodeJS.LTS" }

# --- Settings (first run, or -Setup) ----------------------------------------
$config = $null
if (Test-Path $ConfigPath) { $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json }

if ($Tray -and -not $config) {
  # Setup needs a window for the password prompt.
  Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Install"
  exit 0
}

if ($Setup -or -not $config) {
  Step 'Set up Local NAS'
  Write-Host 'Pick the folder to share (for example your Projects folder). Your files stay where they are.'
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Choose the folder Local NAS should share'
  $dialog.ShowNewFolderButton = $true
  if ($config -and $config.folder) { $dialog.SelectedPath = $config.folder } else { $dialog.SelectedPath = [Environment]::GetFolderPath('UserProfile') }
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Fail 'No folder chosen. Run setup again when you are ready.' }
  $folder = $dialog.SelectedPath
  Write-Host "Sharing: $folder" -ForegroundColor Green

  do {
    $pw = Read-Secret 'Choose a password for signing in (at least 8 characters)'
    $pw2 = Read-Secret 'Type it again'
    if ($pw -ne $pw2) { Write-Host "They don't match. Try again." -ForegroundColor Yellow }
    elseif ($pw.Length -lt 8) { Write-Host 'Use at least 8 characters.' -ForegroundColor Yellow }
  } while ($pw -ne $pw2 -or $pw.Length -lt 8)

  $defaultName = "$env:USERNAME's PC"
  if ($config -and $config.name) { $defaultName = $config.name }
  $name = Read-Host "Name for this PC [$defaultName]"
  if (-not $name) { $name = $defaultName }

  $config = [pscustomobject]@{ folder = $folder; password = $pw; name = $name; port = 43214 }
  $config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8

  if ($Tray) {
    Write-Host "`nSaved. Local NAS is restarting in the system tray." -ForegroundColor Green
    Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$HiddenLauncher`""
    Start-Sleep -Seconds 2
    exit 0
  }
}

if (-not (Test-Path $config.folder)) { Fail "The shared folder isn't available: $($config.folder)`nConnect the drive, or run setup again to pick another folder." }

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
  if ($LASTEXITCODE -ne 0) { Fail 'Build failed. Run "Start Local NAS.bat" to see the error.' }
}

# --- Environment -------------------------------------------------------------
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

$Port = [int]$config.port
$LocalUrl = "http://localhost:$Port"
$NextBin = [IO.Path]::Combine($AppDir, 'node_modules', 'next', 'dist', 'bin', 'next')

function Get-LaptopUrls {
  $ips = @()
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|VirtualBox|VMware|Hyper-V|Bluetooth' } |
      Select-Object -ExpandProperty IPAddress
  } catch {}
  return @($ips | ForEach-Object { "http://${_}:$Port" })
}

# --- Install: shortcuts, then hand over to the tray app ---------------------
if ($Install) {
  Step 'Adding Local NAS to the Start menu'
  New-Shortcut $StartMenuLink 'Local NAS'
  $answer = Read-Host 'Start Local NAS automatically when Windows starts? [Y/n]'
  if ($answer -notmatch '^(n|no)$') { New-Shortcut $StartupLink 'Local NAS (starts with Windows)'; Write-Host 'It will start with Windows.' -ForegroundColor Green }
  Write-Host "`nDone. Local NAS now lives in your system tray (bottom-right, near the clock)." -ForegroundColor Green
  Write-Host 'Right-click its purple icon for options. You can close this window.'
  Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$HiddenLauncher`""
  Start-Sleep -Seconds 3
  exit 0
}

# --- Console mode ------------------------------------------------------------
if (-not $Tray) {
  Write-Host ''
  Write-Host '  Local NAS is starting' -ForegroundColor Magenta
  Write-Host "  Sharing:     $($config.folder)"
  Write-Host "  On this PC:  $LocalUrl" -ForegroundColor Green
  foreach ($u in Get-LaptopUrls) { Write-Host "  On laptop:   $u" -ForegroundColor Green }
  Write-Host ''
  Write-Host '  If Windows asks about network access for Node.js, allow it on Private networks.' -ForegroundColor Yellow
  Write-Host '  Keep this window open. Close it (or press Ctrl+C) to stop Local NAS.'
  Write-Host '  Tip: run "Start Local NAS.bat -Install" to use the tray app instead.'
  Write-Host ''
  Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 4; Start-Process '$LocalUrl'"
  & node $NextBin start -p $Port -H 0.0.0.0
  exit $LASTEXITCODE
}

# --- Tray mode ---------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$createdNew = $false
$script:mutex = New-Object System.Threading.Mutex($true, 'Local-NAS-Tray', [ref]$createdNew)
if (-not $createdNew) {
  Start-Process $LocalUrl
  exit 0
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$script:server = $null
$script:restarts = 0
$script:quitting = $false

function Start-Server {
  $stamp = Get-Date -Format 'yyyy-MM-dd'
  $script:server = Start-Process -FilePath 'node' -ArgumentList "`"$NextBin`" start -p $Port -H 0.0.0.0" -WorkingDirectory $AppDir `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "server-$stamp.log") -RedirectStandardError (Join-Path $LogDir "server-$stamp.err.log")
}

function Stop-Server {
  if ($script:server -and -not $script:server.HasExited) {
    & taskkill /PID $script:server.Id /T /F 2>$null | Out-Null
  }
  $script:server = $null
}

function Invoke-Sync {
  try {
    $session = $null
    Invoke-RestMethod -Uri "$LocalUrl/api/login" -Method Post -ContentType 'application/json' -Body (@{ password = $config.password } | ConvertTo-Json) -SessionVariable session | Out-Null
    Invoke-RestMethod -Uri "$LocalUrl/api/sync" -Method Post -ContentType 'application/json' -Body '{"action":"run"}' -WebSession $session | Out-Null
    $notify.ShowBalloonTip(3000, 'Local NAS', 'Sync started.', 'Info')
  } catch {
    $notify.ShowBalloonTip(5000, 'Local NAS', 'Couldn''t start a sync. Is it connected to a server? Open Local NAS to check.', 'Warning')
  }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-Object System.Drawing.Icon $IconPath
$notify.Text = 'Local NAS'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('Open Local NAS')
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, 'Bold')
$openItem.add_Click({ Start-Process $LocalUrl })
$copyItem = $menu.Items.Add('Copy laptop address')
$copyItem.add_Click({
  $urls = Get-LaptopUrls
  if ($urls.Count -gt 0) {
    [System.Windows.Forms.Clipboard]::SetText($urls[0])
    $notify.ShowBalloonTip(3000, 'Local NAS', "Copied $($urls[0]). Open it on your laptop (same Wi-Fi).", 'Info')
  } else {
    $notify.ShowBalloonTip(4000, 'Local NAS', 'This PC has no network address right now. Is it connected to Wi-Fi?', 'Warning')
  }
})
$folderItem = $menu.Items.Add('Open shared folder')
$folderItem.add_Click({ Start-Process explorer.exe -ArgumentList "`"$($config.folder)`"" })
$syncItem = $menu.Items.Add('Sync now')
$syncItem.add_Click({ Invoke-Sync })
[void]$menu.Items.Add('-')
$startupItem = New-Object System.Windows.Forms.ToolStripMenuItem 'Start with Windows'
$startupItem.CheckOnClick = $true
$startupItem.Checked = Test-Path $StartupLink
$startupItem.add_Click({
  if ($startupItem.Checked) { New-Shortcut $StartupLink 'Local NAS (starts with Windows)' }
  elseif (Test-Path $StartupLink) { Remove-Item $StartupLink -Force }
})
[void]$menu.Items.Add($startupItem)
$settingsItem = $menu.Items.Add('Change folder or password...')
$settingsItem.add_Click({
  Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Setup -Tray"
  $notify.ShowBalloonTip(5000, 'Local NAS', 'Finish setup in the new window. Local NAS will restart with the new settings.', 'Info')
  $script:quitting = $true
  Stop-Server
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$logItem = $menu.Items.Add('View log')
$logItem.add_Click({ Start-Process explorer.exe -ArgumentList "`"$LogDir`"" })
$restartItem = $menu.Items.Add('Restart')
$restartItem.add_Click({ Stop-Server; $script:restarts = 0; Start-Server; $notify.ShowBalloonTip(2000, 'Local NAS', 'Restarted.', 'Info') })
[void]$menu.Items.Add('-')
$quitItem = $menu.Items.Add('Quit Local NAS')
$quitItem.add_Click({
  $script:quitting = $true
  Stop-Server
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Start-Process $LocalUrl })

Start-Server
$urls = Get-LaptopUrls
$hint = 'Double-click the tray icon to open it.'
if ($urls.Count -gt 0) { $hint = "On your laptop open $($urls[0])" }
$notify.ShowBalloonTip(5000, 'Local NAS is running', $hint, 'Info')

# Restart the server if it stops unexpectedly (up to 3 times in a row).
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  if ($script:quitting -or -not $script:server -or -not $script:server.HasExited) { return }
  if ($script:restarts -ge 3) {
    $timer.Stop()
    $notify.ShowBalloonTip(8000, 'Local NAS stopped', 'It stopped several times. Right-click the icon and choose View log, or run "Start Local NAS.bat" to see why.', 'Error')
    return
  }
  $script:restarts++
  Start-Server
})
$timer.Start()

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  Stop-Server
  $notify.Dispose()
  $script:mutex.ReleaseMutex()
}
