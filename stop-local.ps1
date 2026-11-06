$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root '.local-runtime'
if (-not (Test-Path -LiteralPath $runtime)) { Write-Output 'No launcher-owned local servers were recorded.'; exit 0 }
foreach ($name in @('frontend', 'backend')) {
  $pidPath = Join-Path $runtime "$name.pid"
  $startedPath = Join-Path $runtime "$name.started"
  if (-not (Test-Path -LiteralPath $pidPath) -or -not (Test-Path -LiteralPath $startedPath)) { continue }
  $processId = [int](Get-Content -LiteralPath $pidPath -Raw)
  $expectedStart = (Get-Content -LiteralPath $startedPath -Raw).Trim()
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    $started = $process.StartTime.ToUniversalTime().ToString('o')
    if ($process.ProcessName -eq 'node' -and $started -eq $expectedStart) {
      Stop-Process -Id $process.Id
      Write-Output "Stopped launcher-owned $name."
    } else {
      Write-Output "Skipped PID $processId because it no longer matches the launcher record."
    }
  } catch { Write-Output "$name is not running." }
  Remove-Item -LiteralPath $pidPath,$startedPath -Force -ErrorAction SilentlyContinue
}
