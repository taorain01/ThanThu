$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$taskName = 'OpenClaw Discord Bot'
$botRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$entryPath = Join-Path $botRoot 'src\index.js'
$envPath = Join-Path $botRoot '.env'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing environment file: $envPath"
}

$action = New-ScheduledTaskAction `
  -Execute $nodeExe `
  -Argument "`"$entryPath`"" `
  -WorkingDirectory $botRoot
$manualTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$manualTrigger.Enabled = $false
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $manualTrigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Dedicated Discord bridge for the local OpenClaw gateway.' `
  -Force | Out-Null

Write-Output "Installed manual Scheduled Task: $taskName"
