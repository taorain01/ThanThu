$filePath = 'c:\Bot Discord\src\commands\bangchien\bangchien.js'
$lines = Get-Content $filePath
$out = [System.Collections.ArrayList]@()
$skip = $false
$i = 0
foreach ($line in $lines) {
    $i++
    if ($i -eq 459) { $skip = $true }
    if (-not $skip) { $out.Add($line) | Out-Null }
    if ($skip -and $i -eq 476) { $skip = $false }
}
$out | Set-Content $filePath -Encoding UTF8
Write-Host "Done. Lines: $($out.Count)"
