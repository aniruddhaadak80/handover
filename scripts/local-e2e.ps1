param([int]$Port = 3988, [string]$Project = "desktop")

$env:HANDOVER_ALLOW_EMBEDDED = "1"
$env:PGLITE_DATA_DIR = ".data/pglite-e2e"
$root = "C:\Users\ANIRUDDHA\Desktop\Projects\handover"

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Start-Sleep -Seconds 1

$server = Start-Process -FilePath "node" `
  -ArgumentList "node_modules\next\dist\bin\next", "start", "-p", "$Port" `
  -WorkingDirectory $root `
  -RedirectStandardOutput "$env:USERPROFILE\.hv-e2e.log" `
  -RedirectStandardError "$env:USERPROFILE\.hv-e2e.err" `
  -WindowStyle Hidden -PassThru

try {
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 3
    try {
      $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 120 -UseBasicParsing
      if ($probe.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Write-Output "HEALTH NEVER PASSED"; exit 1 }
  Write-Output "server ready on $Port"

  $env:BASE_URL = "http://127.0.0.1:$Port"
  if ($env:E2E_GREP) { npx playwright test --project=$Project --grep $env:E2E_GREP } else { npx playwright test --project=$Project }
  exit $LASTEXITCODE
}
finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}