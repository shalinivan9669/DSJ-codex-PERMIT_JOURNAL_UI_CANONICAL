param([switch]$ResumeSeed)
$ErrorActionPreference='Stop'
$demoProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $demoProduct
. (Join-Path $PSScriptRoot 'lms-pass02-env.ps1') -Database chain
$demoRecoveryRoot=Join-Path $demoProduct '.runtime/lms-pass02-operations-20261018'
$demoRecoveryStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$demoBackup=Join-Path $demoRecoveryRoot "recovery-backup-$demoRecoveryStamp"
$demoTargetStorage=Join-Path $demoRecoveryRoot 'restored-storage'
$demoProfile=Join-Path $demoRecoveryRoot 'recovery-profile'
$demoEvidence=Join-Path $demoProduct 'docs/evidence/lms-full-tz-pass-02-operations-20261018'
if (!$ResumeSeed) {
  & pnpm --config.enableGlobalVirtualStore=false db:deploy *> (Join-Path $demoRecoveryRoot 'recovery-migrate.log')
  if($LASTEXITCODE -ne 0){throw 'RECOVERY_MIGRATIONS_FAILED'}
  & pnpm --config.enableGlobalVirtualStore=false exec tsx scripts/verification/lms-pass02-recovery.ts seed *> (Join-Path $demoRecoveryRoot 'recovery-seed.log')
  if($LASTEXITCODE -ne 0){throw 'RECOVERY_SEED_FAILED; inspect private log'}
}
if(!(Test-Path -LiteralPath (Join-Path $demoRecoveryRoot 'recovery-fixture.private.json'))){throw 'RECOVERY_FIXTURE_REQUIRED'}
if(Test-Path -LiteralPath $demoTargetStorage){throw 'RESTORE_TARGET_MUST_BE_NEW; no deletion or overwrite'}
if(Test-Path -LiteralPath $demoProfile){throw 'RESTORE_PROFILE_MUST_BE_NEW; no deletion or overwrite'}
# Only this disposable source has been used by the terminated harness process. No shared runtime is stopped.
$env:DEMO_MAINTENANCE='1'
$demoBackupWatch=[Diagnostics.Stopwatch]::StartNew()
& node deployment/backup.mjs backup $demoBackup *> (Join-Path $demoRecoveryRoot 'recovery-backup.log')
if($LASTEXITCODE -ne 0){throw 'BACKUP_FAILED'}
$demoBackupWatch.Stop()
$demoRestoreWatch=[Diagnostics.Stopwatch]::StartNew()
New-Item -ItemType Directory -Path $demoProfile | Out-Null
# Key dependency is separately copied, never embedded in the database/file backup or public evidence.
Copy-Item -LiteralPath (Join-Path $demoRecoveryRoot 'chain-mfa-keys.private.json') -Destination (Join-Path $demoProfile 'mfa-keys.json')
& (Join-Path $demoProduct '.runtime/postgresql/pgsql/bin/createdb.exe') -h 127.0.0.1 -p 55479 -U demo_local demo_test_lms_pass02_restored
if($LASTEXITCODE -ne 0){throw 'RESTORE_DATABASE_MUST_BE_NEW; no existing database is modified'}
. (Join-Path $PSScriptRoot 'lms-pass02-env.ps1') -Database restored
$env:DEMO_MAINTENANCE='1'
& node deployment/backup.mjs restore $demoBackup *> (Join-Path $demoRecoveryRoot 'recovery-restore.log')
if($LASTEXITCODE -ne 0){throw 'RESTORE_FAILED'}
& node deployment/backup.mjs verify $demoBackup *> (Join-Path $demoRecoveryRoot 'recovery-verify.log')
if($LASTEXITCODE -ne 0){throw 'RESTORE_HASH_VERIFY_FAILED'}
$demoRestoreWatch.Stop()
$demoResumeWatch=[Diagnostics.Stopwatch]::StartNew()
& pnpm --config.enableGlobalVirtualStore=false exec tsx scripts/verification/lms-pass02-recovery.ts resume *> (Join-Path $demoRecoveryRoot 'recovery-resume.log')
if($LASTEXITCODE -ne 0){throw 'RESTORED_OPERATIONS_FAILED'}
$demoResumeWatch.Stop()
# Prove the original source stayed byte/content equivalent to its offline snapshot after the restored copy resumed.
. (Join-Path $PSScriptRoot 'lms-pass02-env.ps1') -Database chain
& node deployment/backup.mjs verify $demoBackup *> (Join-Path $demoRecoveryRoot 'recovery-source-unchanged.log')
if($LASTEXITCODE -ne 0){throw 'SOURCE_CHANGED_DURING_RESTORE_DRILL'}
$demoManifest=Get-Content -Raw -LiteralPath (Join-Path $demoBackup 'manifest.json') | ConvertFrom-Json
$demoBytes=(Get-ChildItem -LiteralPath $demoBackup -File -Recurse | Measure-Object -Property Length -Sum).Sum
$demoResult=[ordered]@{status='PASS';backupDirectory=$demoBackup;sourceDatabase='demo_test_lms_pass02_chain';restoredDatabase='demo_test_lms_pass02_restored';backupMilliseconds=$demoBackupWatch.ElapsedMilliseconds;restoreAndHashVerifyMilliseconds=$demoRestoreWatch.ElapsedMilliseconds;resumeAndLoginMilliseconds=$demoResumeWatch.ElapsedMilliseconds;backupBytes=$demoBytes;databaseDumpBytes=(Get-Item -LiteralPath (Join-Path $demoBackup 'database.dump')).Length;privateFiles=@($demoManifest.files.PSObject.Properties).Count;tables=@($demoManifest.databaseCounts.PSObject.Properties).Count;sourceUnchanged=$true;keysCopiedSeparately=$true;databaseRowsAndFilesSha256Verified=$true;scope='Synthetic local measurement; not production RPO/RTO'}
$demoResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $demoEvidence 'RECOVERY_TIMING_AC31.json') -Encoding utf8
$demoResult | ConvertTo-Json -Depth 6
