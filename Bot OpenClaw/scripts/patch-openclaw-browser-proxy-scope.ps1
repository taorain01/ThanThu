$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$openClawRoot = Join-Path $env:APPDATA 'npm\node_modules\openclaw'
$packagePath = Join-Path $openClawRoot 'package.json'
if (-not (Test-Path -LiteralPath $packagePath)) {
  throw "Không tìm thấy OpenClaw tại $openClawRoot"
}

$package = Get-Content -LiteralPath $packagePath -Raw -Encoding utf8 | ConvertFrom-Json
if ($package.version -notlike '2026.7.1*') {
  Write-Output "Bỏ qua bản vá browser.proxy cho OpenClaw $($package.version); chỉ áp dụng cho 2026.7.1."
  exit 0
}

$needle = @'
function resolveLeastPrivilegeOperatorScopesForMethod(method, params) {
	if (isDynamicOperatorGatewayMethod(method)) return resolveDynamicLeastPrivilegeOperatorScopesForMethod(method, params);
'@
$replacement = @'
function resolveLeastPrivilegeOperatorScopesForMethod(method, params) {
	if (method === "node.invoke" && normalizeOptionalString(params?.command) === "browser.proxy") return [ADMIN_SCOPE];
	if (isDynamicOperatorGatewayMethod(method)) return resolveDynamicLeastPrivilegeOperatorScopesForMethod(method, params);
'@
$patchedMarker = 'normalizeOptionalString(params?.command) === "browser.proxy"'
$candidates = @(Get-ChildItem -LiteralPath (Join-Path $openClawRoot 'dist') -Filter 'method-scopes-*.js' -File |
  Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw -Encoding utf8).Contains(
      'function resolveLeastPrivilegeOperatorScopesForMethod'
    )
  })

if ($candidates.Count -ne 1) {
  throw "Không xác định duy nhất bundle method-scopes của OpenClaw: $($candidates.Count) file."
}

$targetPath = $candidates[0].FullName
$content = Get-Content -LiteralPath $targetPath -Raw -Encoding utf8
if ($content.Contains($patchedMarker)) {
  Write-Output "Bản vá browser.proxy đã có sẵn: $targetPath"
  exit 0
}
if (-not $content.Contains($needle)) {
  throw 'Bundle OpenClaw không còn khớp mẫu an toàn; không tự sửa.'
}

$backupPath = "$targetPath.pre-browser-proxy-scope-patch"
if (-not (Test-Path -LiteralPath $backupPath)) {
  Copy-Item -LiteralPath $targetPath -Destination $backupPath
}

$patched = $content.Replace($needle, $replacement)
$temporaryPath = "$targetPath.$PID.tmp"
try {
  [System.IO.File]::WriteAllText(
    $temporaryPath,
    $patched,
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporaryPath -Destination $targetPath -Force
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

Write-Output "Đã vá scope operator.admin cho node.invoke browser.proxy: $targetPath"
