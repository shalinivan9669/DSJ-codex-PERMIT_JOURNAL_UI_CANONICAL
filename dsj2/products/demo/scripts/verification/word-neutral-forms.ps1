param([string]$Directory = '.runtime\neutral-forms-20261005')
$ErrorActionPreference = 'Stop'
$auditPath = (Resolve-Path -LiteralPath $Directory).Path
$wordApp = $null
$rows = @()
try {
    $wordApp = New-Object -ComObject Word.Application
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $wordApp.AutomationSecurity = 3
    foreach ($sourceFile in (Get-ChildItem -LiteralPath $auditPath -Filter '*.docx' -File)) {
        $document = $null
        try {
            $before = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
            $document = $wordApp.Documents.Open($sourceFile.FullName, $false, $true, $false)
            $document.Repaginate()
            $pages = $document.ComputeStatistics(2)
            $pdf = Join-Path $auditPath ($sourceFile.BaseName + '.word.pdf')
            $document.ExportAsFixedFormat($pdf, 17)
            $rows += [pscustomobject]@{ case = $sourceFile.BaseName; status = 'EXPORTED'; pages = $pages; version = $wordApp.Version; build = $wordApp.Build; sourceSha256 = $before; unchanged = ($before -eq (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash) }
            Write-Output ($sourceFile.BaseName + ': ' + $pages + ' pages')
        } catch {
            $rows += [pscustomobject]@{ case = $sourceFile.BaseName; status = 'FAILED'; error = $_.Exception.Message }
        } finally {
            if ($null -ne $document) { $document.Close(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
        }
        $rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $auditPath 'word-export.json') -Encoding utf8
    }
} finally {
    if ($null -ne $wordApp) { $wordApp.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wordApp) }
}
if (@($rows | Where-Object status -ne 'EXPORTED').Count -gt 0) { exit 1 }
