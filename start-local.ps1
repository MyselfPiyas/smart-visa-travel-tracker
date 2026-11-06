$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$runtime = Join-Path $root '.local-runtime'
$logs = Join-Path $runtime 'logs'
$node = (Get-Command node.exe -ErrorAction Stop).Source

foreach ($requiredPath in @((Join-Path $backend 'src\server.js'), (Join-Path $frontend 'node_modules\vite\bin\vite.js'))) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Project files are missing: $requiredPath. Install dependencies from the project root first."
  }
}

New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Get-HttpResponse([string]$Url) {
  try { return Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing } catch { return $null }
}

function Test-LocalPort([int]$Port) {
  foreach ($address in @('::1', '127.0.0.1')) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $task = $client.ConnectAsync($address, $Port)
      if ($task.Wait(300) -and $client.Connected) { return $true }
    } catch { } finally { $client.Dispose() }
  }
  return $false
}

function Start-TrackedNode([string]$Name, [string]$WorkingDirectory, [string[]]$Arguments) {
  $output = Join-Path $logs "$Name.log"
  $errorOutput = Join-Path $logs "$Name.error.log"
  $process = Start-Process -FilePath $node -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errorOutput -PassThru
  $process.Id | Set-Content -LiteralPath (Join-Path $runtime "$Name.pid") -Encoding ASCII
  $process.StartTime.ToUniversalTime().ToString('o') | Set-Content -LiteralPath (Join-Path $runtime "$Name.started") -Encoding ASCII
  return $process
}

$apiReadyUrl = 'http://127.0.0.1:5000/api/health/ready'
$apiLiveUrl = 'http://127.0.0.1:5000/api/health/live'
$api = Get-HttpResponse $apiLiveUrl
if (-not $api) {
  if (Test-LocalPort 5000) { throw 'Port 5000 is occupied but the tracker API health route did not respond. Stop the old backend and run this launcher again.' }
  Write-Output 'Starting the tracker API...'
  Start-TrackedNode 'backend' $backend @('src/server.js') | Out-Null
} else {
  Write-Output 'Tracker API is already running.'
}

$siteUrl = 'http://localhost:5173/'
$siteProbeUrl = 'http://[::1]:5173/'
$site = Get-HttpResponse $siteProbeUrl
if (-not $site) {
  if (Test-LocalPort 5173) { throw 'Port 5173 is occupied by another service. Close that service, then run this launcher again.' }
  Write-Output 'Starting the website...'
  # Chrome resolves localhost to ::1 first on Windows. Bind only to IPv6 loopback
  # so localhost works without exposing the development server to the LAN.
  Start-TrackedNode 'frontend' $frontend @((Join-Path $frontend 'node_modules\vite\bin\vite.js'), '--host', '::1') | Out-Null
} else {
  Write-Output 'Website is already running.'
}

$api = $null
$site = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if (-not $api) { $api = Get-HttpResponse $apiLiveUrl }
  if (-not $site) { $site = Get-HttpResponse $siteProbeUrl }
  if ($api -and $site) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $site) { throw "The website did not start. See $logs\frontend.error.log" }
if (-not $api) { throw "The API did not start. See $logs\backend.error.log" }

$ready = Get-HttpResponse $apiReadyUrl
if ($ready) {
  Write-Output "Database readiness: $($ready.Content)"
} else {
  Write-Output 'API is running, but the database readiness endpoint is unavailable. Check backend logs.'
}
Write-Output "Website ready: $siteUrl"
Write-Output 'You can now refresh the Chrome tab. Keep the computer on while using localhost.'
