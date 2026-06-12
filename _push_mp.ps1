$ErrorActionPreference = 'Continue'
$gitExe = (Get-ChildItem "C:\Users\PC\AppData\Local\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $gitExe) {
  $gitExe = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
Write-Output "GIT_EXE=$gitExe"
Set-Location "c:\Bot Discord"
& $gitExe add -A 2>&1
& $gitExe commit -m "Redesign music player UI (glass, segmented tabs, mini bar, a11y)" 2>&1
& $gitExe push 2>&1
Write-Output "PUSH_DONE_EXIT=$LASTEXITCODE"
