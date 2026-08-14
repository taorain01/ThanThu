$ErrorActionPreference = 'Continue'
$gitExe = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $gitExe) {
  $gitExe = (Get-ChildItem "C:\Users\PC\AppData\Local\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $gitExe) {
  $gitExe = (Get-ChildItem "C:\Users\songt\AppData\Local\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $gitExe) {
  $gitExe = (Get-Command "git.exe" -ErrorAction SilentlyContinue).Source
}
Write-Output "GIT_EXE=$gitExe"
Set-Location "c:\Bot Discord"
& $gitExe status 2>&1
& $gitExe add -A 2>&1
& $gitExe commit -m "Thêm 5 mẫu siêu thú Chibi và trang tương tác chuyển động animation showcase" 2>&1
& $gitExe push 2>&1
Write-Output "PUSH_DONE_EXIT=$LASTEXITCODE"
