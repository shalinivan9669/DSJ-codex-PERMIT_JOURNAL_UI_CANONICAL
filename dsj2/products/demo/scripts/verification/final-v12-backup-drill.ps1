param(
  [Parameter(Mandatory=$true)][ValidateSet('snapshot','restore')][string]$Mode,
  [ValidateSet(12,13)][int]$SchemaVersion=12
)
$ErrorActionPreference='Stop'
$product=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $product
$runtime=Join-Path $product '.runtime'
. (Join-Path $runtime 'operator-value-browser-env.ps1')
$pgBin='C:\Users\Admin\Documents\DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL\dsj2\products\demo\.runtime\postgresql\pgsql\bin'
$env:DEMO_PSQL=Join-Path $pgBin 'psql.exe'
$env:DEMO_PG_DUMP=Join-Path $pgBin 'pg_dump.exe'
$env:DEMO_PG_RESTORE=Join-Path $pgBin 'pg_restore.exe'
$env:DEMO_MAINTENANCE='1'
$snapshot=Join-Path $runtime "final-v$SchemaVersion-snapshot"
$evidence=Join-Path $product 'docs/evidence/final-completion/recovery'
if ($Mode -eq 'snapshot') {
  # Caller must stop the source API/worker and finish all UI drills first.
  if ($env:DEMO_RECOVERY_SOURCE_QUIESCED -ne 'CONFIRMED_BY_COORDINATOR') {
    throw 'Snapshot requires an explicit coordinator-confirmed write boundary.'
  }
  if (([uri]$env:DATABASE_URL).AbsolutePath -ne '/demo_test_operator_browser') {
    throw 'Unexpected source database.'
  }
  $clock=[Diagnostics.Stopwatch]::StartNew()
  node deployment/backup.mjs backup $snapshot
  if ($LASTEXITCODE -ne 0) { throw 'Snapshot failed; source data preserved.' }
  $clock.Stop()
  $manifest=Get-Content (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.databaseCounts._prisma_migrations -ne $SchemaVersion) { throw 'Snapshot migration count differs from requested schema version.' }
  @{status='PASS';stage='SNAPSHOT';sourceDatabase='demo_test_operator_browser';schemaMigrations=$SchemaVersion;backupMs=$clock.ElapsedMilliseconds;manifest=$manifest;sourceProcessesControlledBy='parent coordinator'} | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $evidence "final-v$SchemaVersion-snapshot.json")
  Write-Output 'SNAPSHOT_COMPLETE_SOURCE_CAN_RESUME'
  exit 0
}
if (!(Test-Path -LiteralPath (Join-Path $snapshot 'manifest.json'))) { throw 'No completed snapshot.' }
# createdb refuses an existing target; this drill never drops or reuses a database.
$restoreDatabase="demo_test_restore_final_v$SchemaVersion"
& (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55439 -U postgres $restoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Fresh restore database could not be created.' }
$env:DATABASE_URL="postgresql://postgres@127.0.0.1:55439/$restoreDatabase"
$env:DEMO_ARTIFACT_ROOT=Join-Path $runtime "final-v$SchemaVersion-restored-artifacts"
$clock=[Diagnostics.Stopwatch]::StartNew()
node deployment/backup.mjs restore $snapshot
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; source data preserved.' }
node deployment/backup.mjs verify $snapshot
if ($LASTEXITCODE -ne 0) { throw 'Offline reconciliation failed.' }
$clock.Stop()
Remove-Item Env:DEMO_MAINTENANCE
$auth=Get-Content (Join-Path $runtime 'final-v12-restore-auth.json') -Raw | ConvertFrom-Json
$env:DEMO_ADMIN_EMAIL=$auth.email
$env:DEMO_ADMIN_PASSWORD=$auth.password
$env:DEMO_CONTAINER_ACCEPTANCE='SYNTHETIC_ONLY'
$env:PORT='4137'
pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/verify-restored-http.ts .runtime/final-v12-restore-fixture.json "docs/evidence/final-completion/recovery/final-v$SchemaVersion-http-readback.json"
if ($LASTEXITCODE -ne 0) { throw 'Restored HTTP readback failed.' }
if ($SchemaVersion -eq 13) {
  $partyEvidence='docs/evidence/final-completion/order-parties-v3/result.json'
  $party=Get-Content $partyEvidence -Raw | ConvertFrom-Json
  $partyAuth=Get-Content (Join-Path $runtime 'final-order-parties-auth.json') -Raw | ConvertFrom-Json
  if ($party.status -ne 'PASS' -or !$party.realUi -or $party.tenantId -ne $partyAuth.tenantId -or $party.orderId -ne $partyAuth.orderId) { throw 'Exact real-UI party fixture and restored login do not match.' }
  $party | Add-Member -NotePropertyName artifacts -NotePropertyValue @() -Force
  $party | Add-Member -NotePropertyName photoIds -NotePropertyValue @() -Force
  $party | Add-Member -NotePropertyName sourceUiEvidence -NotePropertyValue $partyEvidence -Force
  [IO.File]::WriteAllText((Join-Path $runtime 'final-v13-order-parties-fixture.json'), ($party | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
  $env:DEMO_ADMIN_EMAIL=$partyAuth.email
  $env:DEMO_ADMIN_PASSWORD=$partyAuth.password
  pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/verify-restored-http.ts .runtime/final-v13-order-parties-fixture.json docs/evidence/final-completion/recovery/final-v13-order-parties-http-readback.json
  if ($LASTEXITCODE -ne 0) { throw 'Restored exact three-party order HTTP readback failed.' }
}
$manifest=Get-Content (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
@{status='PASS';acceptance='AT183';sourceDatabase='demo_test_operator_browser';restoreDatabase=$restoreDatabase;requestId='4bc699b5-cfaf-42a6-8e3c-d7465bfc8ebf';sourceEvidence='delivery-three-v3/result.json';restoreAndVerifyMs=$clock.ElapsedMilliseconds;schemaMigrations=$SchemaVersion;productionTouched=$false;manifest=$manifest} | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $evidence "final-v$SchemaVersion-restore.json")
Write-Output 'RESTORE_AND_EXACT_V12_HTTP_PASS'
