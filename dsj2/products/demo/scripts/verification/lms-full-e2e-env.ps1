param([Parameter(Mandatory=$true)][string]$RunId)
$ErrorActionPreference='Stop'
if($RunId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{7,79}$') { throw 'UNIQUE_RUN_ID_REQUIRED' }
. (Join-Path $PSScriptRoot 'lms-test-env.ps1') browser
$env:DEMO_ORIGIN='http://127.0.0.1:3159'
$env:DEMO_NEXT_DIST_DIR='.next-lms-final'
$env:DEMO_E2E_FULL_CHECKPOINTS='1'
$env:DEMO_E2E_FULL_RUN_ID=$RunId
$env:DEMO_E2E_EVIDENCE=Join-Path $product "docs/evidence/lms-one-run-20261015/agent-c/$RunId"
New-Item -ItemType Directory -Force -Path $env:DEMO_E2E_EVIDENCE | Out-Null
$env:DEMO_E2E_API_LOG=Join-Path $env:DEMO_E2E_EVIDENCE 'runtime-api-stdout.log'
$env:DEMO_E2E_API_ERROR_LOG=Join-Path $env:DEMO_E2E_EVIDENCE 'runtime-api-stderr.log'
$env:DEMO_E2E_TRACE='off'
$env:DEMO_E2E_ISOLATED_TENANT='1'
$env:DEMO_E2E_TENANT_ID='2aea57c9-25a1-4091-a513-a66c03edd27e'
$env:DEMO_LMS_REGISTRATION_TENANT_ID=$env:DEMO_E2E_TENANT_ID
$env:DEMO_ADMIN_EMAIL='lms-full-admin-20261015@example.test'
$env:DEMO_OPERATOR_EMAIL='lms-full-operator-20261015@example.test'
$env:DEMO_DIRECTOR_EMAIL='lms-director-20261015@example.test'
$env:DEMO_ADMIN_PASSWORD='Synthetic-LMS-only-20261015!'
$env:DEMO_OPERATOR_PASSWORD=$env:DEMO_ADMIN_PASSWORD
$env:DEMO_DIRECTOR_PASSWORD=$env:DEMO_ADMIN_PASSWORD
$env:DEMO_E2E_EMAIL=$env:DEMO_OPERATOR_EMAIL
$env:DEMO_E2E_PASSWORD=$env:DEMO_OPERATOR_PASSWORD
$env:DEMO_E2E_PORTRAIT=Join-Path $runtime 'e2e-fixtures/portrait-test-pattern.png'
$env:DEMO_E2E_LARGE_PHOTO=Join-Path $runtime 'e2e-fixtures/large-synthetic.jpg'
$env:DEMO_COMPARE_EXPECT_FIXED='1'
$env:DEMO_LMS_BASELINE_PHASE='current-full-suite'
foreach($name in @('DEMO_E2E_G1_CONTINUE_PREPARATION','DEMO_E2E_G1_CONTINUE_ISSUANCE_CHECKPOINT','DEMO_E2E_COMMON_CONTINUE_CHECKPOINT','DEMO_E2E_MANUAL_REQUEST_ID','DEMO_E2E_MANUAL20_REQUEST_ID','DEMO_E2E_MANUAL20_PROPOSAL_ID','DEMO_E2E_MANUAL20_CHECKPOINT','DEMO_REVIEW_PROPOSAL_ID','DEMO_E2E_PORTAL_FIXTURE','DEMO_E2E_SCALE_REQUEST_ID','DEMO_E2E_DOMAIN_REASON_PRECHECK_ONLY')) {
  [Environment]::SetEnvironmentVariable($name,$null,'Process')
}
