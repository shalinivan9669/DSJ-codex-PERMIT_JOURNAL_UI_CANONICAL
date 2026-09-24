$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskOutput = Join-Path $taskRoot 'docs/evidence/final-completion/word'
$taskFixtures = Get-Content -LiteralPath (Join-Path $taskOutput 'fixtures.json') -Raw | ConvertFrom-Json
$taskWord = $null
$taskRecords = @()
try {
    $taskWord = New-Object -ComObject Word.Application
    $taskWord.Visible = $false
    $taskWord.DisplayAlerts = 0
    $taskWord.AutomationSecurity = 3
    $taskWord.Options.UpdateLinksAtOpen = $false
    $taskEngine = @{name='Microsoft Word';version=$taskWord.Version;build=$taskWord.Build;path=$taskWord.Path}
    foreach ($taskFixture in $taskFixtures) {
        $taskDocument = $null
        try {
            $taskSource = [IO.Path]::GetFullPath($taskFixture.path)
            if (-not $taskSource.StartsWith($taskOutput + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture path outside verification directory' }
            $taskPdf = [IO.Path]::ChangeExtension($taskSource, '.word.pdf')
            $taskDocument = $taskWord.Documents.Open($taskSource, $false, $true, $false)
            $taskDocument.Repaginate()
            $taskDocument.ExportAsFixedFormat($taskPdf, 17)
            $taskRecords += @{file=[IO.Path]::GetFileName($taskSource);pdf=[IO.Path]::GetFileName($taskPdf);pages=$taskDocument.ComputeStatistics(2);status='PASS'}
            Write-Output ([IO.Path]::GetFileName($taskPdf))
        } finally {
            if ($null -ne $taskDocument) { $taskDocument.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDocument) }
        }
    }
    @{engine=$taskEngine;convertedAt=[DateTime]::UtcNow.ToString('o');results=$taskRecords} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskOutput 'word-conversions.json') -Encoding utf8
} finally {
    if ($null -ne $taskWord) { $taskWord.Quit(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord) }
}
