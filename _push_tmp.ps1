$ErrorActionPreference = "Stop"
$gitExe = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $gitExe) {
    Write-Output "KHONG_TIM_THAY_GIT"
    exit 1
}
Write-Output "GIT_EXE=$gitExe"
& $gitExe status
& $gitExe add -A
& $gitExe commit -m "Them luat cung giao tiep 100% tieng Viet vao steering"
& $gitExe push
