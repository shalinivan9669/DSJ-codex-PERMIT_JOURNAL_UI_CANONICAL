param([ValidateSet('integration','browser')][string]$Database='integration')
$ErrorActionPreference='Stop'
$demoProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoRuntime=Join-Path $demoProduct '.runtime/lms-completion-20261018'
$demoTools=Join-Path $demoProduct '.runtime/lms-one-run'
$env:CI='true'
$env:DATABASE_URL="postgresql://postgres@127.0.0.1:55469/demo_test_lms_completion_${Database}_20261018?connection_limit=4"
$demoTarget=[uri]$env:DATABASE_URL
if($demoTarget.Host -ne '127.0.0.1' -or $demoTarget.Port -ne 55469 -or !$demoTarget.AbsolutePath.StartsWith('/demo_test_lms_completion_')) { throw 'TASK_OWNED_TEST_DATABASE_REQUIRED' }
$env:DEMO_ARTIFACT_ROOT=Join-Path $demoRuntime "$Database-storage"
$env:DEMO_PYTHON=Join-Path $demoTools 'python/Scripts/python.exe'
$env:DEMO_SOFFICE=Join-Path $demoTools 'libreoffice/program/soffice.com'
$env:DEMO_PSQL=Join-Path $demoTools 'postgresql/pgsql/bin/psql.exe'
$env:DEMO_PG_DUMP=Join-Path $demoTools 'postgresql/pgsql/bin/pg_dump.exe'
$env:DEMO_PG_RESTORE=Join-Path $demoTools 'postgresql/pgsql/bin/pg_restore.exe'
$env:DEMO_ORIGIN='http://localhost:3328'
$env:DEMO_API_ORIGIN='http://127.0.0.1:4328'
$env:HOST='127.0.0.1'
$env:PORT='4328'
$env:DEMO_NEXT_DIST_DIR='.next-lms-completion-20261018'
$env:DEMO_E2E_CHANNEL='chrome'
$env:DEMO_LMS_TEST_RUNTIME='1'
$env:DEMO_LMS_SCALING_FIXTURE=Join-Path $demoRuntime 'browser-fixture.json'
$env:DEMO_E2E_EVIDENCE=Join-Path $demoProduct 'docs/evidence/lms-tz-completion-20261018/browser'
foreach($demoExecutable in @($env:DEMO_PYTHON,$env:DEMO_SOFFICE,$env:DEMO_PSQL,$env:DEMO_PG_DUMP,$env:DEMO_PG_RESTORE)) {
  if(!(Test-Path -LiteralPath $demoExecutable -PathType Leaf)) { throw "LOCAL_TEST_RUNTIME_MISSING: $demoExecutable" }
}
