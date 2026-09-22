param(
  [Parameter(Mandatory=$true)][string]$InputDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$inputRoot = (Resolve-Path -LiteralPath $InputDirectory).Path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.UpdateLinksAtOpen = $false
  $version = $word.Version
  $build = $word.Build
  foreach ($file in (Get-ChildItem -LiteralPath $inputRoot -File | Where-Object { $_.Name -match '-(short|long)\.docx$' } | Sort-Object Name)) {
    $doc = $null
    $before = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    try {
      $doc = $word.Documents.Open($file.FullName, $false, $true, $false)
      $doc.Repaginate()
      $pages = $doc.ComputeStatistics(2)
      $pdf = Join-Path $outputRoot ($file.BaseName + '.word.pdf')
      $doc.ExportAsFixedFormat($pdf, 17)
      $results.Add([PSCustomObject]@{file=$file.Name;status='PASS';pages=$pages;pdf=[System.IO.Path]::GetFileName($pdf);docxSha256=$before.ToLower();pdfSha256=(Get-FileHash -LiteralPath $pdf -Algorithm SHA256).Hash.ToLower()})
    } catch {
      $results.Add([PSCustomObject]@{file=$file.Name;status='FAIL';error=$_.Exception.Message})
    } finally {
      if ($doc) { $doc.Close(0); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc) }
    }
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $before) { throw "Source changed during read-only Word verification: $($file.Name)" }
    [PSCustomObject]@{wordVersion=$version;wordBuild=$build;mode='read-only, macros disabled, no links update';documents=@($results.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'word-results.json') -Encoding utf8
    Write-Output $file.Name
  }
} finally {
  if ($word) { $word.Quit(0); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
