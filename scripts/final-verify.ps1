$ErrorActionPreference = "Continue"
$repo = "C:\Users\jay\Desktop\Projects\Projects\Middleware"
Set-Location $repo

$steps = @(
  @{ name = "build";         cmd = "pnpm build" },
  @{ name = "typecheck";     cmd = "pnpm typecheck" },
  @{ name = "lint";          cmd = "pnpm lint" },
  @{ name = "unit tests";    cmd = "pnpm test" },
  @{ name = "integration";   cmd = "pnpm test:integration" }
)

$failures = @()
foreach ($s in $steps) {
  Write-Output ""
  Write-Output "===== $($s.name) ====="
  Invoke-Expression $s.cmd 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
    $failures += "$($s.name) (exit $LASTEXITCODE)"
    Write-Output "!!!!! $($s.name) FAILED (exit $LASTEXITCODE)"
  } else {
    Write-Output "===== $($s.name): OK ====="
  }
}

Write-Output ""
if ($failures.Count -eq 0) {
  Write-Output "FINAL VERIFY: ALL GREEN"
} else {
  Write-Output "FINAL VERIFY FAILED: $($failures -join ', ')"
  exit 1
}
