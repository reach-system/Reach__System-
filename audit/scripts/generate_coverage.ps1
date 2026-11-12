# Regenerates audit/COVERAGE.md from the repository, preserving status.
# Statuses are read from audit/scripts/reviewed.txt (one relative path per line).
# Files listed in audit/scripts/excluded.txt are marked EXCLUDED with a reason.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$reviewedFile = Join-Path $PSScriptRoot 'reviewed.txt'
$excludedFile = Join-Path $PSScriptRoot 'excluded.txt'

$norm = { param($p) ($p.Trim() -replace '\\', '/') }
$reviewed = @{}
if (Test-Path $reviewedFile) {
  Get-Content $reviewedFile | Where-Object { $_.Trim() } | ForEach-Object { $reviewed[(& $norm $_)] = $true }
}
$excluded = @{}
if (Test-Path $excludedFile) {
  Get-Content $excludedFile | Where-Object { $_.Trim() } | ForEach-Object {
    $parts = $_ -split '\|', 2
    if ($parts.Count -eq 2) { $excluded[(& $norm $parts[0])] = $parts[1].Trim() }
  }
}

$skipDir = '^audit\\|(^|\\)(node_modules|\.git|dist|build|bin|obj|\.next|coverage|uploads)\\'
$skipFile = '^(package-lock\.json|.*\.png|.*\.jpg|.*\.jpeg|.*\.svg|.*\.ico|.*\.log|.*\.lock|.*\.tsv)$'

$rows = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $rel -notmatch $skipDir -and $_.Name -notmatch $skipFile
  } |
  ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $key = $rel -replace '\\', '/'
    $lines = @(Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue).Count
    $status = if ($excluded.ContainsKey($key)) { "EXCLUDED" } elseif ($reviewed.ContainsKey($key)) { "REVIEWED" } else { "PENDING" }
    [PSCustomObject]@{ Path = $rel; Lines = $lines; Status = $status; Note = $excluded[$key] }
  } | Sort-Object Path

$reviewedCount = ($rows | Where-Object { $_.Status -eq 'REVIEWED' }).Count
$excludedCount = ($rows | Where-Object { $_.Status -eq 'EXCLUDED' }).Count
$pending = ($rows | Where-Object { $_.Status -eq 'PENDING' }).Count
$total = $rows.Count
$pct = if ($total -gt 0) { [math]::Round(($reviewedCount / [double]$total) * 100, 1) } else { 0 }

$out = @()
$out += '# Coverage Ledger'
$out += ''
$out += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$out += ''
$out += "| Metric | Value |"
$out += "|---|---|"
$out += "| Files in scope | $total |"
$out += "| REVIEWED | $reviewedCount |"
$out += "| EXCLUDED | $excludedCount |"
$out += "| PENDING | $pending |"
$out += "| Coverage | $pct% |"
$out += ''
$out += 'Status values: PENDING / REVIEWED / EXCLUDED.'
$out += ''
$out += '| # | File | Lines | Status | Note |'
$out += '|---:|---|---:|---|---|'
$i = 0
foreach ($r in $rows) {
  $i++
  $out += "| $i | ``$($r.Path)`` | $($r.Lines) | $($r.Status) | $($r.Note) |"
}
Set-Content -LiteralPath (Join-Path $root 'audit\COVERAGE.md') -Value $out -Encoding UTF8
Write-Output "COVERAGE.md: $reviewedCount/$total reviewed ($pct%), $excludedCount excluded, $pending pending"
