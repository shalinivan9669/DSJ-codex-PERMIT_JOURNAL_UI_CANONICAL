param([ValidateSet('browser','integration')][string]$Database='browser')
$ErrorActionPreference='Stop'
$mvpProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$mvpRuntime=Join-Path $mvpProduct '.runtime/mvp-all-roles-20261019/run-01'
$env:DATABASE_URL="postgresql://demo_mvp@127.0.0.1:55489/demo_test_mvp_roles_20261019_run01_${Database}?connection_limit=6"
$mvpTarget=[uri]$env:DATABASE_URL
if($mvpTarget.Host -ne '127.0.0.1' -or $mvpTarget.Port -ne 55489 -or !$mvpTarget.AbsolutePath.StartsWith('/demo_test_mvp_roles_20261019_run01_')) {throw 'ISOLATED_MVP_DATABASE_REQUIRED'}
$env:DEMO_ARTIFACT_ROOT=Join-Path $mvpRuntime "$Database-storage"
$env:DEMO_PYTHON=Join-Path $mvpProduct '.runtime/lms-one-run/python/Scripts/python.exe'
$env:DEMO_SOFFICE=Join-Path $mvpProduct '.runtime/lms-one-run/libreoffice/program/soffice.com'
$env:DEMO_PSQL=Join-Path $mvpProduct '.runtime/postgresql/pgsql/bin/psql.exe'
$env:DEMO_PG_DUMP=Join-Path $mvpProduct '.runtime/postgresql/pgsql/bin/pg_dump.exe'
$env:DEMO_PG_RESTORE=Join-Path $mvpProduct '.runtime/postgresql/pgsql/bin/pg_restore.exe'
$env:DEMO_ORIGIN='http://127.0.0.1:3349'
$env:DEMO_API_ORIGIN='http://127.0.0.1:4349'
$env:HOST='127.0.0.1'
$env:PORT='4349'
$env:DEMO_NEXT_DIST_DIR='.next-mvp-roles-run01'
$env:DEMO_E2E_CHANNEL='chrome'
$env:DEMO_E2E_TRACE='off'
$env:DEMO_LMS_TEST_RUNTIME='1'
$env:DEMO_E2E_EVIDENCE=Join-Path $mvpProduct 'docs/evidence/mvp-all-roles-20261019/run-01/browser'
$env:DEMO_MVP_FIXTURE=Join-Path $mvpRuntime 'browser-fixture.json'
$env:TSX_TSCONFIG_PATH=Join-Path $mvpProduct 'tsconfig.base.json'
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
$env:DEMO_RENDER_CONCURRENCY='1'
$env:CI='true'
$env:DEMO_MFA_KEY_VERSION='v1'
$mvpMfaPath=Join-Path $mvpRuntime 'mfa-keys.json'
if(!(Test-Path -LiteralPath $mvpMfaPath)) {
  $mvpKey=[byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($mvpKey)
  @{v1=[Convert]::ToBase64String($mvpKey)} | ConvertTo-Json -Compress | Set-Content -LiteralPath $mvpMfaPath
}
$env:DEMO_MFA_KEYS=Get-Content -Raw -LiteralPath $mvpMfaPath
# Registration is explicitly bound by the synthetic fixture, never by a client tenant ID.
$env:DEMO_LMS_REGISTRATION_TENANT_ID=''
if(Test-Path -LiteralPath $env:DEMO_MVP_FIXTURE) {
  $mvpFixture=Get-Content -Raw -LiteralPath $env:DEMO_MVP_FIXTURE | ConvertFrom-Json
  $env:DEMO_LMS_REGISTRATION_TENANT_ID=$mvpFixture.tenantId
}
