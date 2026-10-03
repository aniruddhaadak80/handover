param(
  [int]$Port = 3988,
  [string]$Base = ""
)

$ErrorActionPreference = "Continue"
$env:HANDOVER_ALLOW_EMBEDDED = "1"
$env:PGLITE_DATA_DIR = ".data/pglite-local"
$root = "C:\Users\ANIRUDDHA\Desktop\Projects\handover"

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

$server = Start-Process -FilePath "node" `
  -ArgumentList "node_modules\next\dist\bin\next", "start", "-p", "$Port" `
  -WorkingDirectory $root `
  -RedirectStandardOutput "$env:USERPROFILE\.hv-run.log" `
  -RedirectStandardError "$env:USERPROFILE\.hv-run.err" `
  -WindowStyle Hidden `
  -PassThru

try {
  # PGlite compiles its Postgres WASM on first boot, which can take minutes.
  $listening = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $listening = $true; break }
    if ($server.HasExited) { break }
  }
  if (-not $listening) {
    Write-Output "SERVER DID NOT START LISTENING"
    Get-Content "$env:USERPROFILE\.hv-run.err" -Tail 30 | Out-String -Width 200
    exit 1
  }
  Write-Output "server listening on $Port; waiting for health"

  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 3
    try {
      $probe = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -TimeoutSec 120 -UseBasicParsing
      if ($probe.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    Write-Output "HEALTH NEVER PASSED"
    Get-Content "$env:USERPROFILE\.hv-run.err" -Tail 30 | Out-String -Width 200
    exit 1
  }

  Write-Output "server ready on $Port"
  if ($Base) { $env:BASE_URL = $Base } else { $env:BASE_URL = "http://127.0.0.1:$Port" }
  $env:EXPECT_DRIVER = "pglite"
  node scripts/verify-live.mjs
  $code = $LASTEXITCODE
  Write-Output ""
  Write-Output "=== server stderr (tail) ==="
  Get-Content "$env:USERPROFILE\.hv-run.err" -Tail 25 -ErrorAction SilentlyContinue | Out-String -Width 200
  exit $code
}
finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}