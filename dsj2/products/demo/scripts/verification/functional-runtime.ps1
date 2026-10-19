param(
  [ValidateSet('browser','clean','restore','user')][string]$Target='browser',
  [ValidateSet('start','stop','status','restart')][string]$Action='start',
  [ValidateSet('auto','development','production')][string]$WebMode='auto',
  [switch]$StopDatabase,
  [switch]$ApiOnly
)
$ErrorActionPreference='Stop'
if($ApiOnly -and $StopDatabase){throw 'API_ONLY_CANNOT_STOP_DATABASE'}
. (Join-Path $PSScriptRoot 'functional-env.ps1') $Target
$functionalMeta=Join-Path $functionalRuntime "$Target-processes.private.json"
$functionalPgData=Join-Path $functionalProduct '.runtime/mvp-all-roles-20261019/run-01/pgdata'
$functionalPgPort=55489
if($Target -eq 'user'){$functionalPgData=Join-Path $functionalProduct '.runtime/pgdata';$functionalPgPort=55432}
$functionalPgCtl=Join-Path $functionalProduct '.runtime/postgresql/pgsql/bin/pg_ctl.exe'
$functionalNode=(Get-Command node).Source
$functionalRelease=Join-Path $functionalProduct 'apps/web/.next-functional-release/BUILD_ID'
$functionalProduction=$WebMode -eq 'production' -or ($WebMode -eq 'auto' -and (Test-Path -LiteralPath $functionalRelease))
if($functionalProduction -and !(Test-Path -LiteralPath $functionalRelease)){throw 'PRODUCTION_BUILD_REQUIRED'}
if($functionalProduction){$env:DEMO_NEXT_DIST_DIR='.next-functional-release'}
$functionalNextAction=if($functionalProduction){'start'}else{'dev'}
$functionalServices=@(
  @{name='api';arguments=@('--import','tsx','apps/api/src/main.ts');cwd=$functionalProduct;port=$functionalPorts[$Target][1]},
  @{name='render';arguments=@('--import','tsx','apps/render-worker/src/main.ts');cwd=$functionalProduct;port=0},
  @{name='integration';arguments=@('--import','tsx','apps/integration-worker/src/main.ts');cwd=$functionalProduct;port=0},
  @{name='web';arguments=@('node_modules/next/dist/bin/next',$functionalNextAction,'-H','127.0.0.1','-p',[string]$functionalPorts[$Target][0]);cwd=(Join-Path $functionalProduct 'apps/web');port=$functionalPorts[$Target][0]}
)
if($ApiOnly){$functionalServices=@($functionalServices|Where-Object {$_.name -eq 'api'})}
$functionalOwned=@()
if(Test-Path -LiteralPath $functionalMeta){$functionalOwned=@((Get-Content -Raw -LiteralPath $functionalMeta|ConvertFrom-Json).services)}
function Assert-FunctionalProcess($record) {
  $live=Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)"
  if(!$live){return $null}
  if($live.CommandLine -ne $record.command -or $live.ExecutablePath -ne $record.executable -or $live.CreationDate.ToUniversalTime().ToString('o') -ne ([datetime]$record.createdAt).ToUniversalTime().ToString('o')){throw "PROCESS_PROVENANCE_MISMATCH:$($record.name)"}
  return $live
}
function Save-FunctionalProcesses {
  @{target=$Target;database=$functionalUri.AbsolutePath;services=@($script:functionalOwned)}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $functionalMeta
}
if($Action -eq 'status'){
  foreach($record in @($functionalOwned|Where-Object {!$ApiOnly -or $_.name -eq 'api'})){$live=Assert-FunctionalProcess $record;Write-Output "$Target $($record.name): $([bool]$live)"}
  exit 0
}
if($Action -in @('stop','restart')){
  foreach($record in @($functionalOwned|Where-Object {!$ApiOnly -or $_.name -eq 'api'})){
    $live=Assert-FunctionalProcess $record
    if($live){
      # Next may fork a server child. Stop only descendants of the verified parent.
      $children=Get-CimInstance Win32_Process -Filter "ParentProcessId=$($record.pid)"
      foreach($child in $children){
        if($child.Name -eq 'node.exe' -and $child.CreationDate -ge $live.CreationDate -and $child.CommandLine -like '*next*'){Stop-Process -Id $child.ProcessId -Force}
      }
      Stop-Process -Id $record.pid -Force
    }
  }
  if($ApiOnly){$functionalOwned=@($functionalOwned|Where-Object {$_.name -ne 'api'})}else{$functionalOwned=@()}
  Save-FunctionalProcesses
  if($StopDatabase){
    $checkedPorts=if($Target -eq 'user'){@(3200,4200)}else{@(3349,3350,3351,3347,4349,4350,4351,4347)}
    $others=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in $checkedPorts}
    if($others){throw 'OTHER_FUNCTIONAL_SERVICES_RUNNING_DATABASE_NOT_STOPPED'}
    & $functionalPgCtl -D $functionalPgData -m fast -w stop
    if($LASTEXITCODE){throw 'DATABASE_STOP_FAILED'}
  }
  if($Action -eq 'stop'){Write-Output "$Target stopped";exit 0}
}
& $functionalPgCtl -D $functionalPgData status *> $null
if($LASTEXITCODE -ne 0){
  if(Get-NetTCPConnection -LocalPort $functionalPgPort -State Listen -ErrorAction SilentlyContinue){throw 'DATABASE_PORT_OWNED_BY_ANOTHER_PROCESS'}
  & $functionalPgCtl -D $functionalPgData -l (Join-Path $functionalRuntime "$Target-postgres.log") -o "-h 127.0.0.1 -p $functionalPgPort" -w start
  if($LASTEXITCODE){throw 'DATABASE_START_FAILED'}
}
$functionalDbUser=$functionalUri.UserInfo.Split(':')[0]
$functionalActual=& $env:DEMO_PSQL -h 127.0.0.1 -p $functionalPgPort -U $functionalDbUser -d $functionalUri.AbsolutePath.TrimStart('/') -tAc 'SELECT current_database()'
if($LASTEXITCODE -ne 0 -or $functionalActual.Trim() -ne $functionalUri.AbsolutePath.TrimStart('/')){throw 'DATABASE_IDENTITY_MISMATCH'}
foreach($service in $functionalServices){
  $prior=$functionalOwned|Where-Object {$_.name -eq $service.name}|Select-Object -First 1
  if($prior -and (Assert-FunctionalProcess $prior)){continue}
  if($service.port -and (Get-NetTCPConnection -LocalPort $service.port -State Listen -ErrorAction SilentlyContinue)){throw "PORT_ALREADY_OCCUPIED:$($service.port)"}
  $log=Join-Path $functionalRuntime "$Target-$($service.name)"
  $started=Start-Process -FilePath $functionalNode -ArgumentList $service.arguments -WorkingDirectory $service.cwd -WindowStyle Hidden -PassThru -RedirectStandardOutput "$log.stdout.log" -RedirectStandardError "$log.stderr.log"
  $live=Get-CimInstance Win32_Process -Filter "ProcessId=$($started.Id)"
  if(!$live){throw "PROCESS_EXITED:$($service.name):$log.stderr.log"}
  $functionalOwned=@($functionalOwned|Where-Object {$_.name -ne $service.name})+@(@{name=$service.name;pid=$live.ProcessId;command=$live.CommandLine;executable=$live.ExecutablePath;createdAt=$live.CreationDate.ToUniversalTime().ToString('o');cwd=$service.cwd})
  Save-FunctionalProcesses
}
foreach($url in @("$env:DEMO_API_ORIGIN/health","$env:DEMO_ORIGIN/login")){
  $ready=$false
  for($attempt=0;$attempt -lt 30;$attempt++){
    try{$response=Invoke-WebRequest -Uri $url -TimeoutSec 5;if($response.StatusCode -eq 200){$ready=$true;break}}catch{}
    Start-Sleep -Milliseconds 500
  }
  if(!$ready){throw "READINESS_FAILED:$url"}
}
Write-Output "$Target ready: $env:DEMO_ORIGIN/login"
