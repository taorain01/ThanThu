$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$sourcePath = Join-Path $PSScriptRoot 'OpenClawBotControl.cs'
$projectPath = Split-Path $PSScriptRoot -Parent
$outputDirectory = Join-Path $projectPath 'bin'
$outputPath = Join-Path $outputDirectory 'OpenClaw Discord Bot.exe'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compilerPath)) {
  throw "C# compiler not found: $compilerPath"
}

if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

# Rebuild only when the controller source changed, so an already-open controller
# does not prevent subsequent shortcut launches.
if ((Test-Path -LiteralPath $outputPath) -and
    ((Get-Item -LiteralPath $outputPath).LastWriteTimeUtc -ge
     (Get-Item -LiteralPath $sourcePath).LastWriteTimeUtc)) {
  Write-Output "Application is current: $outputPath"
  exit 0
}

if (Test-Path -LiteralPath $outputPath) {
  [System.IO.File]::Delete($outputPath)
}

& $compilerPath `
  /nologo `
  /target:winexe `
  /optimize+ `
  /platform:anycpu `
  /codepage:65001 `
  /reference:System.Windows.Forms.dll `
  /reference:System.Drawing.dll `
  /reference:System.Management.dll `
  "/out:$outputPath" `
  $sourcePath

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
  throw 'Could not build the bot control application.'
}

Write-Output "Created application: $outputPath"
