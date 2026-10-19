param([ValidateSet('browser','user')][string]$Target='browser',[switch]$StopOnly)
$ErrorActionPreference='Stop'
$mvpProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$mvpRuntime=Join-Path $mvpProduct '.runtime/mvp-all-roles-20261019/run-01'
if($Target -eq 'browser') {
  . (Join-Path $PSScriptRoot 'mvp-roles-env.ps1') browser
  $mvpMetaPath=Join-Path $mvpRuntime 'processes.json'
} else {
  $mvpPrivate=Get-Content -Raw -LiteralPath (Join-Path $mvpRuntime 'user-installation-env.private.json') | ConvertFrom-Json
  foreach($mvpProperty in $mvpPrivate.PSObject.Properties) {[Environment]::SetEnvironmentVariable($mvpProperty.Name,[string]$mvpProperty.Value,'Process')}
  $mvpDb=[uri]$env:DATABASE_URL
  if($mvpDb.Host -ne '127.0.0.1' -or $mvpDb.Port -ne 55432 -or $mvpDb.AbsolutePath -ne '/demo_test_browser_commercial_20260922') {throw 'USER_DATABASE_PROVENANCE_MISMATCH'}
  $mvpMetaPath=Join-Path $mvpRuntime 'user-processes.json'
}
$mvpMetadata=Get-Content -Raw -LiteralPath $mvpMetaPath | ConvertFrom-Json
foreach($mvpService in $mvpMetadata.services) {
  if($mvpService.name -eq 'web') {continue}
  $mvpSource=switch($mvpService.name){'api' {'apps/api/src/main.ts'}; 'render' {'apps/render-worker/src/main.ts'}; 'render-worker' {'apps/render-worker/src/main.ts'}; 'integration' {'apps/integration-worker/src/main.ts'}; 'integration-worker' {'apps/integration-worker/src/main.ts'};default {throw 'UNKNOWN_SERVICE'}}
  $mvpRunning=Get-CimInstance Win32_Process -Filter "ProcessId=$($mvpService.pid)"
  if($mvpRunning -and ($mvpRunning.CommandLine -ne $mvpService.command -or $mvpRunning.CreationDate.ToUniversalTime().ToString('o') -ne ([datetime]$mvpService.createdAt).ToUniversalTime().ToString('o'))) {throw 'PROCESS_OWNERSHIP_MISMATCH'}
  if($mvpRunning) {Stop-Process -Id $mvpService.pid -Force}
  if($StopOnly) {Write-Output "$Target $($mvpService.name) stopped after ownership check"; continue}
  $mvpLog=Join-Path $mvpRuntime "$Target-$($mvpService.name)"
  $mvpStarted=Start-Process -FilePath (Get-Command node).Source -ArgumentList '--import','tsx',$mvpSource -WorkingDirectory $mvpProduct -WindowStyle Hidden -PassThru -RedirectStandardOutput "$mvpLog.stdout.log" -RedirectStandardError "$mvpLog.stderr.log"
  $mvpLive=Get-CimInstance Win32_Process -Filter "ProcessId=$($mvpStarted.Id)"
  $mvpService.pid=$mvpStarted.Id
  $mvpService.command=$mvpLive.CommandLine
  $mvpService.createdAt=$mvpLive.CreationDate.ToUniversalTime().ToString('o')
  $mvpMetadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $mvpMetaPath
  Write-Output "$Target $($mvpService.name) pid=$($mvpStarted.Id)"
}
