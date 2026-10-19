param([ValidatePattern('^[a-z0-9_]+$')][string]$Database='browser')
$ErrorActionPreference='Stop'
$demoProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoRuntime=Join-Path $demoProduct '.runtime/lms-pass02-operations-20261018'
$env:CI='true'
$env:DATABASE_URL="postgresql://demo_local@127.0.0.1:55479/demo_test_lms_pass02_${Database}?connection_limit=4"
$demoTarget=[uri]$env:DATABASE_URL
if($demoTarget.Host -ne '127.0.0.1' -or $demoTarget.Port -ne 55479 -or !$demoTarget.AbsolutePath.StartsWith('/demo_test_lms_pass02_')) { throw 'TASK_OWNED_TEST_DATABASE_REQUIRED' }
$env:DEMO_ARTIFACT_ROOT=Join-Path $demoRuntime "$Database-storage"
$env:DEMO_PYTHON=Join-Path $demoProduct '.runtime/lms-one-run/python/Scripts/python.exe'
$env:DEMO_SOFFICE=Join-Path $demoProduct '.runtime/lms-one-run/libreoffice/program/soffice.com'
$env:DEMO_PSQL=Join-Path $demoProduct '.runtime/postgresql/pgsql/bin/psql.exe'
$env:DEMO_PG_DUMP=Join-Path $demoProduct '.runtime/postgresql/pgsql/bin/pg_dump.exe'
$env:DEMO_PG_RESTORE=Join-Path $demoProduct '.runtime/postgresql/pgsql/bin/pg_restore.exe'
$env:DEMO_ORIGIN='http://127.0.0.1:3339'
$env:DEMO_API_ORIGIN='http://127.0.0.1:4339'
$env:HOST='127.0.0.1'
$env:PORT='4339'
$env:DEMO_NEXT_DIST_DIR='.next-lms-pass02-operations-20261018'
$env:DEMO_E2E_CHANNEL='chrome'
$env:DEMO_LMS_TEST_RUNTIME='1'
$env:DEMO_LMS_PASS02_FIXTURE=Join-Path $demoRuntime 'browser-fixture.json'
$env:DEMO_E2E_EVIDENCE=Join-Path $demoProduct 'docs/evidence/lms-full-tz-pass-02-operations-20261018/browser'
$env:TSX_TSCONFIG_PATH=Join-Path $demoProduct 'tsconfig.base.json'
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
$env:DEMO_RENDER_CONCURRENCY='1'

$env:DEMO_MFA_KEY_VERSION='v1'
$demoMfaKeys=Join-Path $demoRuntime 'mfa-keys.json'
if(Test-Path -LiteralPath $demoMfaKeys){$env:DEMO_MFA_KEYS=Get-Content -Raw -LiteralPath $demoMfaKeys}
$env:DEMO_LMS_REGISTRATION_TENANT_ID='b95a85f3-3f8a-4ae5-9a5e-1eb7dec4af75'
