param([ValidateSet('integration','browser')][string]$Database='integration')
$ErrorActionPreference='Stop'
$product=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtime=Join-Path $product '.runtime/lms-one-run'
$env:CI='true'
$env:DATABASE_URL="postgresql://postgres@127.0.0.1:55449/demo_test_lms_${Database}_20261015?connection_limit=10"
$target=[uri]$env:DATABASE_URL
if($target.Host -ne '127.0.0.1' -or !$target.AbsolutePath.StartsWith('/demo_test_lms_')) { throw 'OWN_DISPOSABLE_DATABASE_REQUIRED' }
$env:DEMO_ARTIFACT_ROOT=Join-Path $runtime "$Database-storage"
$env:DEMO_PYTHON=Join-Path $runtime 'python/Scripts/python.exe'
$env:DEMO_SOFFICE=Join-Path $runtime 'libreoffice/program/soffice.com'
$env:DEMO_PSQL=Join-Path $runtime 'postgresql/pgsql/bin/psql.exe'
$env:DEMO_PG_DUMP=Join-Path $runtime 'postgresql/pgsql/bin/pg_dump.exe'
$env:DEMO_PG_RESTORE=Join-Path $runtime 'postgresql/pgsql/bin/pg_restore.exe'
$env:DEMO_ORIGIN='http://localhost:3159'
$env:DEMO_API_ORIGIN='http://127.0.0.1:4159'
$env:PORT='4159'
$env:DEMO_NEXT_DIST_DIR='.next-lms-one-run'
$env:DEMO_E2E_CHANNEL='chrome'
$env:DEMO_LMS_TEST_RUNTIME='1'
foreach($executable in @($env:DEMO_PYTHON,$env:DEMO_SOFFICE,$env:DEMO_PSQL,$env:DEMO_PG_DUMP,$env:DEMO_PG_RESTORE)) {
  if(!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw "LOCAL_TEST_RUNTIME_MISSING: $executable" }
}
