param([ValidateSet('before','after','expanded','all')][string]$Scenario='all')
$ErrorActionPreference='Stop'
$performanceProduct=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$performanceRuntime=Join-Path $performanceProduct '.runtime/lms-pass02-operations-20261018'
$performanceDirectory=Join-Path $performanceRuntime 'performance'
$performanceSeed=Join-Path $performanceDirectory 'common-seed.dump'
$performanceSource=Join-Path $performanceRuntime 'source-before'
$performanceStorage=Join-Path $performanceRuntime 'performance_before-storage'
$performancePg=Join-Path $performanceProduct '.runtime/postgresql/pgsql/bin'
$performanceExpectedSeed='23c447c4f5336ca900f0d39b1c8eb31d02b965a0e3351e2c9d7378119f2ae0bf'
foreach($performanceRequired in @($performanceSeed,$performanceSource,$performanceStorage,(Join-Path $performanceDirectory 'fixture.json'),(Join-Path $performancePg 'pg_restore.exe'))) {
  if(!(Test-Path -LiteralPath $performanceRequired)){throw "Required local evidence is missing: $performanceRequired"}
}
if((Get-FileHash -LiteralPath $performanceSeed -Algorithm SHA256).Hash.ToLowerInvariant() -ne $performanceExpectedSeed){throw 'COMMON_SEED_HASH_MISMATCH'}
$performanceScenarios=if($Scenario -eq 'all'){@('before','after','expanded')}else{@($Scenario)}
Push-Location -LiteralPath $performanceProduct
try {
  # No database or directory is dropped, reset, overwritten or renamed. Run once
  # in an otherwise quiet local window; stop other heavy tests through their owners.
  foreach($performanceCase in $performanceScenarios) {
    $performanceSuffix=if($performanceCase -eq 'expanded'){'performance_expanded'}else{"performance_${performanceCase}_serial"}
    $performanceDatabase="demo_test_lms_pass02_$performanceSuffix"
    $performanceTargetStorage=Join-Path $performanceRuntime "$performanceSuffix-storage"
    $performanceExisting=& (Join-Path $performancePg 'psql.exe') -h 127.0.0.1 -p 55479 -U demo_local -d postgres -At -c "SELECT datname FROM pg_database WHERE datname='$performanceDatabase'"
    if($LASTEXITCODE -ne 0){throw 'LOCAL_DATABASE_CHECK_FAILED'}
    if($performanceExisting){throw "Refusing to reuse or reset existing database: $performanceDatabase"}
    if(Test-Path -LiteralPath $performanceTargetStorage){throw "Refusing to overwrite existing storage: $performanceTargetStorage"}
  }
  foreach($performanceCase in $performanceScenarios) {
    $performanceSuffix=if($performanceCase -eq 'expanded'){'performance_expanded'}else{"performance_${performanceCase}_serial"}
    $performanceDatabase="demo_test_lms_pass02_$performanceSuffix"
    . (Join-Path $PSScriptRoot 'lms-pass02-env.ps1') -Database $performanceSuffix
    & (Join-Path $performancePg 'createdb.exe') -h 127.0.0.1 -p 55479 -U demo_local $performanceDatabase
    if($LASTEXITCODE -ne 0){throw 'CREATE_OWN_DATABASE_FAILED'}
    & (Join-Path $performancePg 'pg_restore.exe') -h 127.0.0.1 -p 55479 -U demo_local -d $performanceDatabase --exit-on-error --no-owner --no-privileges $performanceSeed
    if($LASTEXITCODE -ne 0){throw 'RESTORE_COMMON_SEED_FAILED'}
    # pg_dump without --create omits database-specific configuration.
    & (Join-Path $performancePg 'psql.exe') -h 127.0.0.1 -p 55479 -U demo_local -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE $performanceDatabase SET timezone TO 'UTC'"
    if($LASTEXITCODE -ne 0){throw 'SET_DATABASE_UTC_FAILED'}
    Copy-Item -LiteralPath $performanceStorage -Destination $env:DEMO_ARTIFACT_ROOT -Recurse
    Remove-Item Env:PERF_SMOKE,Env:PERF_LEVELS,Env:PERF_SOURCE,Env:PERF_EXPANDED -ErrorAction SilentlyContinue
    if($performanceCase -eq 'before') {
      $env:PERF_SOURCE=$performanceSource
      $env:PERF_LABEL='before-serial'
    } else {
      pnpm --config.enableGlobalVirtualStore=false db:deploy
      if($LASTEXITCODE -ne 0){throw 'CURRENT_MIGRATIONS_FAILED'}
      $env:PERF_LABEL=if($performanceCase -eq 'expanded'){'expanded'}else{'after-serial'}
      if($performanceCase -eq 'expanded'){$env:PERF_EXPANDED='1'}
    }
    $performanceLog=Join-Path $performanceRuntime "performance-$($env:PERF_LABEL).log"
    Write-Host "Running $($env:PERF_LABEL); log: $performanceLog"
    pnpm --config.enableGlobalVirtualStore=false exec tsx --tsconfig tsconfig.base.json scripts/verification/lms-pass02-performance.ts run *> $performanceLog
    if($LASTEXITCODE -ne 0){throw "HARNESS_FAILED: $performanceLog"}
    Get-Content -LiteralPath $performanceLog -Tail 8
    Write-Host "Result: $(Join-Path $performanceDirectory "$($env:PERF_LABEL).json")"
  }
} finally {
  Remove-Item Env:PERF_SOURCE,Env:PERF_EXPANDED -ErrorAction SilentlyContinue
  Pop-Location
}
