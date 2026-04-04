$file = "tactics.html"

Write-Output "=== TIMER PATTERNS ==="
Select-String -Path $file -Pattern 'setInterval|setTimeout|requestAnimationFrame' | ForEach-Object {
    $l = $_.Line.Trim()
    if ($l.Length -gt 150) { $l = $l.Substring(0,150) }
    Write-Output "$($_.LineNumber): $l"
}

Write-Output "`n=== EVENT LISTENERS ==="
Select-String -Path $file -Pattern 'addEventListener|onmousemove|ontouchmove' | ForEach-Object {
    $l = $_.Line.Trim()
    if ($l.Length -gt 150) { $l = $l.Substring(0,150) }
    Write-Output "$($_.LineNumber): $l"
}

Write-Output "`n=== BACKDROP-FILTER ==="
Select-String -Path $file -Pattern 'backdrop-filter' | ForEach-Object {
    $l = $_.Line.Trim()
    if ($l.Length -gt 150) { $l = $l.Substring(0,150) }
    Write-Output "$($_.LineNumber): $l"
}

Write-Output "`n=== BOX-SHADOW COUNT ==="
(Select-String -Path $file -Pattern 'box-shadow' -AllMatches).Count

Write-Output "`n=== FILTER (CSS) COUNT ==="
(Select-String -Path $file -Pattern 'filter:' -AllMatches).Count

Write-Output "`n=== ANIMATION/KEYFRAMES COUNT ==="
(Select-String -Path $file -Pattern '@keyframes|animation:' -AllMatches).Count

Write-Output "`n=== TRANSITION COUNT ==="
(Select-String -Path $file -Pattern 'transition:' -AllMatches).Count

Write-Output "`n=== WILL-CHANGE ==="
Select-String -Path $file -Pattern 'will-change' | ForEach-Object {
    Write-Output "$($_.LineNumber): $($_.Line.Trim())"
}

Write-Output "`n=== MOUSEMOVE/TOUCHMOVE/SCROLL HANDLERS ==="
Select-String -Path $file -Pattern 'mousemove|touchmove|pointermove|scroll' | ForEach-Object {
    $l = $_.Line.Trim()
    if ($l.Length -gt 150) { $l = $l.Substring(0,150) }
    Write-Output "$($_.LineNumber): $l"
}

Write-Output "`n=== DRAG AND DROP ==="
Select-String -Path $file -Pattern 'dragstart|dragend|dragover|ondrag|dragging' | ForEach-Object {
    $l = $_.Line.Trim()
    if ($l.Length -gt 150) { $l = $l.Substring(0,150) }
    Write-Output "$($_.LineNumber): $l"
}
