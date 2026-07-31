$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$sourcePath = Join-Path $PSScriptRoot 'OpenClawBotControl.cs'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$outputPath = Join-Path $desktopPath 'OpenClaw Discord Bot.exe'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compilerPath)) {
  throw "C# compiler not found: $compilerPath"
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
