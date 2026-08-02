# Restart Bot OpenClaw - dung de restart tu xa hoac thu cong
# Cach dung:
#   powershell -NoProfile -ExecutionPolicy Bypass -File restart-bot.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File restart-bot.ps1 -ForceKill
[CmdletBinding()]
param(
  [switch]$ForceKill
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$taskName = 'OpenClaw Discord Bot'
$botRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source

Write-Output "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Restart Bot OpenClaw..."

# ---------------------------------------------------------- Dung Scheduled Task
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if ($task.State -eq 'Running') {
    Write-Output "  Scheduled Task '$taskName' dang chay."
    if ($ForceKill) {
      Write-Output "  -ForceKill: Stop Scheduled Task truoc..."
      Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
      # Cho task dung han
      $timeout = 10
      while ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready' -and $timeout -gt 0) {
        Start-Sleep -Seconds 1
        $timeout--
      }
    }
    else {
      Write-Output "  Dung Scheduled Task truoc..."
      Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
      $timeout = 10
      while ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready' -and $timeout -gt 0) {
        Start-Sleep -Seconds 1
        $timeout--
      }
    }
  }
}
catch {
  Write-Output "  Scheduled Task khong tim thay hoac khong dung duoc: $_"
}

# ---------------------------------------------------------- Kill process cu
Write-Output "  Kiem tra process Node.js cho Bot OpenClaw..."
$killed = 0
try {
  $processes = Get-Process -Name 'node' -ErrorAction SilentlyContinue
  foreach ($proc in $processes) {
    try {
      $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
      if ($cmdLine -match 'Bot OpenClaw\\src\\index\.js|bot-openclaw' -and $cmdLine -notmatch 'gateway|openclaw\.mjs') {
        Write-Output "  Kill process $($proc.Id)..."
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        $killed++
      }
    }
    catch {
      # Khong doc duoc command line - bo qua
    }
  }
}
catch {
  Write-Output "  Khong tim thay process Node.js."
}
Write-Output "  Da kill $killed process Node.js."

# ---------------------------------------------------------- Start lai
Start-Sleep -Seconds 2

try {
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  Write-Output "  Da start Scheduled Task '$taskName'."
}
catch {
  Write-Output "  LOI: Khong start duoc Scheduled Task: $_"
  Write-Output "  Fallback: Start bot truc tiep..."

  $runnerPath = Join-Path $botRoot 'scripts\run-bot-awake.ps1'
  $entryPath = Join-Path $botRoot 'src\index.js'
  $powerShellExe = Join-Path $PSHOME 'powershell.exe'

  Start-Process -FilePath $powerShellExe `
    -ArgumentList "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`" -NodePath `"$nodeExe`" -EntryPath `"$entryPath`"" `
    -WorkingDirectory $botRoot `
    -NoNewWindow

  Write-Output "  Da start bot truc tiep."
}

$taskState = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State
Write-Output "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Xong. Task state: $taskState"
