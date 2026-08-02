$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$watchdogTaskName = 'OpenClaw Discord Bot Watchdog'
$botRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$watchdogPath = Join-Path $botRoot 'scripts\watchdog.ps1'
$powerShellExe = Join-Path $PSHOME 'powershell.exe'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $watchdogPath)) {
  throw "Missing watchdog script: $watchdogPath"
}

# Xoa task cu neu co
try {
  Unregister-ScheduledTask -TaskName $watchdogTaskName -Confirm:$false -ErrorAction Stop
  Write-Output "Da go task watchdog cu."
}
catch {
  # Chua co task cu
}

$action = New-ScheduledTaskAction `
  -Execute $powerShellExe `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogPath`"" `
  -WorkingDirectory $botRoot

# Chay moi 5 phut, bat dau tu luc cai dat
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -RestartCount 0

Register-ScheduledTask `
  -TaskName $watchdogTaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Kiem tra Bot OpenClaw moi 5 phut va tu dong restart neu bot chet.' `
  -Force | Out-Null

Write-Output "Da cai Watchdog Scheduled Task: $watchdogTaskName"
Write-Output "  Chay moi 5 phut"
Write-Output "  Cooldown restart: 5 phut (tranh restart lien tuc)"

# Chay ngay lan dau
Start-ScheduledTask -TaskName $watchdogTaskName -ErrorAction SilentlyContinue
Write-Output "  Da chay lan dau tien."
