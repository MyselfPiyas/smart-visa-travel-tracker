$ErrorActionPreference = 'Stop'
$taskName = 'Smart Visa Tracker Local Servers'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output 'Automatic startup has been disabled. The currently running website is not stopped.'
} else {
  Write-Output 'Automatic startup was not enabled.'
}
