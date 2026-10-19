param(
  [ValidateSet('Start','Stop','Status')][string]$Action='Status',
  [switch]$StopDatabase
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lms-pass01-env.ps1') -Database browser
$demoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoRuntime=Join-Path $demoRoot '.runtime/lms-pass01-20261018'
$demoManifestPath=Join-Path $demoRuntime 'local-processes.json'
$demoPgData=[IO.Path]::GetFullPath((Join-Path $demoRuntime 'pgdata'))
if(!$demoPgData.StartsWith($demoRuntime+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'INVALID_RUNTIME_PATH'}
$demoPgCtl=Join-Path $demoRoot '.runtime/postgresql/pgsql/bin/pg_ctl.exe'
$demoServices=@(
  @{name='api'; marker='apps/api/src/main.ts'; directory=$demoRoot; arguments=@('--import','tsx','apps/api/src/main.ts'); port=4338},
  @{name='web'; marker='next/dist/bin/next'; directory=(Join-Path $demoRoot 'apps/web'); arguments=@('node_modules/next/dist/bin/next','dev','-p','3338','-H','127.0.0.1'); port=3338},
  @{name='render'; marker='apps/render-worker/src/main.ts'; directory=$demoRoot; arguments=@('--import','tsx','apps/render-worker/src/main.ts'); port=0},
  @{name='integration'; marker='apps/integration-worker/src/main.ts'; directory=$demoRoot; arguments=@('--import','tsx','apps/integration-worker/src/main.ts'); port=0}
)

function Get-OwnedProcess($entry){
  if(!$entry){return $null}
  $candidate=Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.pid)"
  if(!$candidate){return $null}
  if($candidate.CreationDate.ToUniversalTime().ToString('o') -ne ([datetime]$entry.createdAt).ToUniversalTime().ToString('o')){
    Write-Warning "STALE_PID_REUSED: $($entry.name); unrelated process left untouched"
    return $null
  }
  if($candidate.CommandLine -notlike "*$($entry.marker)*"){
    throw "PID_OWNERSHIP_MISMATCH: $($entry.name); process left untouched"
  }
  return $candidate
}
function Get-ProcessTree([int]$parentPid,$allProcesses){
  foreach($child in @($allProcesses | Where-Object ParentProcessId -eq $parentPid)){
    Get-ProcessTree $child.ProcessId $allProcesses
    $child
  }
}
function Test-Port([int]$port){
  $socket=[Net.Sockets.TcpClient]::new()
  try{$socket.Connect('127.0.0.1',$port);return $true}catch{return $false}finally{$socket.Dispose()}
}
$demoState=@{owner='lms-full-tz-pass-01-20261018'; database='demo_test_lms_pass01_browser'; services=@()}
if(Test-Path -LiteralPath $demoManifestPath){
  $saved=Get-Content -LiteralPath $demoManifestPath -Raw | ConvertFrom-Json
  if($saved.owner -ne $demoState.owner -or $saved.database -ne $demoState.database){throw 'RUNTIME_MANIFEST_OWNER_MISMATCH'}
  $demoState.services=@($saved.services)
}
if($Action -eq 'Stop'){
  foreach($entry in $demoState.services){
    $owned=Get-OwnedProcess $entry
    if(!$owned){continue}
    $allProcesses=Get-CimInstance Win32_Process
    foreach($child in @(Get-ProcessTree $owned.ProcessId $allProcesses)){
      $current=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ProcessId)"
      if($current -and $current.CreationDate -eq $child.CreationDate){Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue}
    }
    Stop-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue
  }
  if($StopDatabase){
    if(!(Test-Path -LiteralPath (Join-Path $demoPgData 'PG_VERSION'))){throw 'OWNED_CLUSTER_NOT_FOUND'}
    & $demoPgCtl -D $demoPgData -m fast -w stop
    if($LASTEXITCODE -ne 0){throw 'OWNED_POSTGRES_STOP_FAILED'}
  }
  Write-Output 'Owned application processes stopped; database files and private storage retained.'
  exit 0
}
if($Action -eq 'Start'){
  if(!(Test-Path -LiteralPath (Join-Path $demoPgData 'PG_VERSION'))){throw 'PREPARED_LOCAL_CLUSTER_REQUIRED; see LOCAL_RUN_RU.txt'}
  & $demoPgCtl -D $demoPgData status *> $null
  if($LASTEXITCODE -ne 0){
    if(Test-Port 55479){throw 'POSTGRES_PORT_IN_USE; no foreign process will be stopped'}
    # Wait for pg_ctl itself, not the persistent PostgreSQL process tree or an
    # inherited PowerShell output pipe. Keep startup output in private logs.
    $pgArguments=@('-D',('"'+$demoPgData+'"'),'-l',('"'+(Join-Path $demoRuntime 'postgresql.log')+'"'),'-o','"-h 127.0.0.1 -p 55479"','-w','start')
    $pgStarter=Start-Process -FilePath $demoPgCtl -ArgumentList $pgArguments -RedirectStandardOutput (Join-Path $demoRuntime 'pg-start.stdout.log') -RedirectStandardError (Join-Path $demoRuntime 'pg-start.stderr.log') -WindowStyle Hidden -PassThru
    if(!$pgStarter.WaitForExit(30000)){throw 'OWNED_POSTGRES_START_TIMEOUT'}
    if($pgStarter.ExitCode -ne 0){throw 'OWNED_POSTGRES_START_FAILED'}
  }
  foreach($service in $demoServices){
    $entry=@($demoState.services | Where-Object name -eq $service.name) | Select-Object -First 1
    if(Get-OwnedProcess $entry){continue}
    if($service.port -and (Test-Port $service.port)){throw "PORT_IN_USE: $($service.port); existing process left untouched"}
    $process=Start-Process -FilePath (Get-Command node).Source -ArgumentList $service.arguments -WorkingDirectory $service.directory -RedirectStandardOutput (Join-Path $demoRuntime "$($service.name).stdout.log") -RedirectStandardError (Join-Path $demoRuntime "$($service.name).stderr.log") -WindowStyle Hidden -PassThru
    $actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
    if(!$actual){throw "SERVICE_EXITED: $($service.name); inspect local stderr log"}
    $entry=@{name=$service.name;pid=$actual.ProcessId;createdAt=$actual.CreationDate.ToUniversalTime().ToString('o');marker=$service.marker;directory=$service.directory}
    $demoState.services=@($demoState.services | Where-Object name -ne $service.name)+@($entry)
    $demoState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $demoManifestPath -Encoding utf8
  }
}
$demoState.services | ForEach-Object {
  $owned=Get-OwnedProcess $_
  [pscustomobject]@{Service=$_.name;PID=$_.pid;Running=[bool]$owned}
} | Format-Table -AutoSize
Write-Output 'Local UI: http://localhost:3338/login'
Write-Output "Synthetic accounts: $(Join-Path $demoRuntime 'browser-fixture.json') (private; do not publish passwords)"
Write-Output 'The integration worker prepares local facts only; provider connections remain NOT_CONNECTED.'
exit 0
