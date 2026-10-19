param([ValidateSet('browser','clean','integration','restore','user')][string]$Target='browser')
$ErrorActionPreference='Stop'
$functionalProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$functionalRuntime=Join-Path $functionalProduct '.runtime/functional-completion-20261019/run-01'
New-Item -ItemType Directory -Path $functionalRuntime -Force | Out-Null
$functionalPorts=@{browser=@(3349,4349);clean=@(3350,4350);integration=@(3352,4352);restore=@(3351,4351);user=@(3200,4200)}
$env:DATABASE_URL="postgresql://demo_mvp@127.0.0.1:55489/demo_test_functional_20261019_run01_$Target`?connection_limit=6"
$functionalUri=[uri]$env:DATABASE_URL
if($functionalUri.Host -ne '127.0.0.1' -or $functionalUri.Port -ne 55489 -or $functionalUri.AbsolutePath -ne "/demo_test_functional_20261019_run01_$Target") {throw 'FUNCTIONAL_DATABASE_GUARD'}
$env:DEMO_ARTIFACT_ROOT=Join-Path $functionalRuntime "$Target-storage"
$env:DEMO_PYTHON=Join-Path $functionalProduct '.runtime/lms-one-run/python/Scripts/python.exe'
$env:DEMO_SOFFICE=Join-Path $functionalProduct '.runtime/lms-one-run/libreoffice/program/soffice.com'
$env:DEMO_PSQL=Join-Path $functionalProduct '.runtime/postgresql/pgsql/bin/psql.exe'
$env:DEMO_PG_DUMP=Join-Path $functionalProduct '.runtime/postgresql/pgsql/bin/pg_dump.exe'
$env:DEMO_PG_RESTORE=Join-Path $functionalProduct '.runtime/postgresql/pgsql/bin/pg_restore.exe'
$env:DEMO_ORIGIN="http://127.0.0.1:$($functionalPorts[$Target][0])"
$env:DEMO_API_ORIGIN="http://127.0.0.1:$($functionalPorts[$Target][1])"
$env:HOST='127.0.0.1'
$env:PORT=[string]$functionalPorts[$Target][1]
$env:DEMO_NEXT_DIST_DIR=".next-functional-$Target"
$env:DEMO_E2E_CHANNEL='chrome'
$env:DEMO_E2E_TRACE='off'
$env:DEMO_LMS_TEST_RUNTIME='1'
$env:DEMO_E2E_EVIDENCE=Join-Path $functionalProduct 'docs/evidence/functional-completion-20261019/run-01/browser'
$env:TSX_TSCONFIG_PATH=Join-Path $functionalProduct 'tsconfig.base.json'
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
$env:DEMO_RENDER_CONCURRENCY='1'
$env:DEMO_MFA_KEY_VERSION='v1'
$functionalKeyPath=Join-Path $functionalRuntime 'mfa-keys.private.json'
if(!(Test-Path -LiteralPath $functionalKeyPath)) {
  $functionalKey=[byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($functionalKey)
  @{v1=[Convert]::ToBase64String($functionalKey)}|ConvertTo-Json -Compress|Set-Content -LiteralPath $functionalKeyPath
}
$env:DEMO_MFA_KEYS=Get-Content -Raw -LiteralPath $functionalKeyPath
$env:DEMO_LMS_REGISTRATION_TENANT_ID=''
$env:DEMO_SAMPLE_DATA='0'
$env:DEMO_DEMONSTRATION_MODE='1'
$env:CI='true'
if($Target -eq 'user') {
  $functionalPrivate=Get-Content -Raw -LiteralPath (Join-Path $functionalRuntime 'user-offline-before/config.private.json')|ConvertFrom-Json
  foreach($functionalProperty in $functionalPrivate.PSObject.Properties){[Environment]::SetEnvironmentVariable($functionalProperty.Name,[string]$functionalProperty.Value,'Process')}
  $functionalUri=[uri]$env:DATABASE_URL
  if($functionalUri.Host -ne '127.0.0.1' -or $functionalUri.Port -ne 55432 -or $functionalUri.AbsolutePath -ne '/demo_test_browser_commercial_20260922'){throw 'USER_DATABASE_PROVENANCE_MISMATCH'}
  $env:DEMO_LMS_TEST_RUNTIME=''
  $env:DEMO_DEMONSTRATION_MODE=''
  $env:DEMO_NEXT_DIST_DIR='.next-functional-user'
}
