# Watchdog Bot OpenClaw - chay moi 5 phut qua Scheduled Task
# Neu bot chet -> tu dong restart
[CmdletBinding()]
param(
  [int]$HealthCheckPort = 0,
  [string]$HealthCheckUrl = '',
  [int]$RestartCooldownMinutes = 5
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$taskName = 'OpenClaw Discord Bot'
$botRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$cooldownFile = Join-Path $botRoot 'data\.watchdog_last_restart'

function Write-Log {
  param([string]$Message)
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Write-Output "[$ts] $Message"
}

# ---------------------------------------------------------- Kiem tra cooldown
if (Test-Path -LiteralPath $cooldownFile) {
  try {
    $lastRestart = [datetime]::ParseExact((Get-Content -Path $cooldownFile -Raw).Trim(), 'o', $null)
    $elapsed = (Get-Date) - $lastRestart
    if ($elapsed.TotalMinutes -lt $RestartCooldownMinutes) {
      Write-Log "Skip: moi restart luc $($lastRestart.ToString('HH:mm:ss')) ($([math]::Round($elapsed.TotalMinutes, 1))p truoc)"
      exit 0
    }
  }
  catch {
    # File cooldown hong -> bo qua
  }
}

# ---------------------------------------------------------- Kiem tra bot con song

# Cach 1: Kiem tra Scheduled Task state
$taskRunning = $false
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $taskRunning = ($task.State -eq 'Running')
  Write-Log "Scheduled Task state: $($task.State)"
}
catch {
  Write-Log "Scheduled Task khong tim thay: $_"
}

# Cach 2: Kiem tra process Node.js
$nodeProcesses = @()
try {
  $processes = Get-Process -Name 'node' -ErrorAction SilentlyContinue
  foreach ($proc in $processes) {
    try {
      $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
      if ($cmdLine -match 'Bot OpenClaw\\src\\index\.js|bot-openclaw' -and $cmdLine -notmatch 'gateway|openclaw\.mjs') {
        $nodeProcesses += $proc
        Write-Log "Bot process found: PID $($proc.Id), CPU $([math]::Round($proc.CPU, 1))s, RAM $([math]::Round($proc.WorkingSet64 / 1MB, 1))MB"
      }
    }
    catch {
      # Khong doc duoc CIM
    }
  }
}
catch {
  Write-Log "Khong lay duoc process list."
}

if ($nodeProcesses.Count -gt 0) {
  Write-Log "Bot dang chay ($($nodeProcesses.Count) process). OK."

  # Neu Scheduled Task ko running nhung process con -> co gang attach?
  if (-not $taskRunning) {
    Write-Log "Process con song nhung Task ko running. Co gang start Task..."
    try {
      Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
      Write-Log "Da start lai Scheduled Task."
    }
    catch {
      Write-Log "Khong start duoc Task: $_"
    }
  }
  exit 0
}

# ---------------------------------------------------------- Bot nghi chet -> restart
Write-Log "WARNING: Bot OpenClaw khong chay! Bat dau restart..."

# Ghi cooldown
try {
  New-Item -Path (Split-Path $cooldownFile -Parent) -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
  (Get-Date).ToString('o') | Set-Content -Path $cooldownFile -NoNewline
}
catch {
  Write-Log "Khong ghi duoc cooldown file."
}

# Kill process con sot lai
try {
  $allNodes = Get-Process -Name 'node' -ErrorAction SilentlyContinue
  foreach ($proc in $allNodes) {
    try {
      $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
      if ($cmdLine -match 'Bot OpenClaw\\src\\index\.js|bot-openclaw' -and $cmdLine -notmatch 'gateway|openclaw\.mjs') {
        Write-Log "Kill process con sot $($proc.Id)..."
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
      }
    }
    catch { }
  }
}
catch { }

Start-Sleep -Seconds 2

# Start bot
try {
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  Write-Log "Da restart bot qua Scheduled Task."
}
catch {
  Write-Log "Khong start duoc qua Task, thu start truc tiep..."
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  $runnerPath = Join-Path $botRoot 'scripts\run-bot-awake.ps1'
  $entryPath = Join-Path $botRoot 'src\index.js'
  $powerShellExe = Join-Path $PSHOME 'powershell.exe'

  Start-Process -FilePath $powerShellExe `
    -ArgumentList "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`" -NodePath `"$nodeExe`" -EntryPath `"$entryPath`"" `
    -WorkingDirectory $botRoot `
    -NoNewWindow

  Write-Log "Da start bot truc tiep."
}

Write-Log "Restart hoan tat."
