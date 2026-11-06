$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root 'start-local.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'start-local.ps1 was not found beside this file.' }
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Smart Visa Tracker Local Servers' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts the local Smart Visa Tracker website and API after sign-in.' -Force | Out-Null
Write-Output 'Local website and API will start automatically after you sign in to Windows.'
Write-Output 'To disable automatic startup, double-click disable-local-startup.cmd.'
