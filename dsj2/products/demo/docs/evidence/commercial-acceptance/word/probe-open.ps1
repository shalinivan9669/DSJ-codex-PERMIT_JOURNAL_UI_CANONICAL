param([Parameter(Mandatory=$true)][string]$ProductRoot,[string[]]$FilePaths,[string]$RunName='corruption-isolation')
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $ProductRoot).Path
$out=Join-Path $root ('docs/evidence/commercial-acceptance/word/'+$RunName)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$inputs=@(
  (Join-Path $root '../../docs/experimental/biot/biot-card-template.docx'),
  (Join-Path $root 'docs/evidence/commercial-acceptance/printing/historical-inputs/biot-worker-card.v4.docx')
)
$inputs+=@(Get-ChildItem -LiteralPath (Join-Path $root 'docs/evidence/commercial-acceptance/printing/word-probes') -Filter '*-utf8fixed.docx' | Sort-Object Name | ForEach-Object { $_.FullName })
if($FilePaths){$inputs=$FilePaths}
$word=$null
$results=[Collections.Generic.List[object]]::new()
try {
  $word=New-Object -ComObject Word.Application
  $word.Visible=$false; $word.DisplayAlerts=0; $word.AutomationSecurity=3
  $word.Options.UpdateLinksAtOpen=$false
  foreach($input in $inputs) {
    $file=Get-Item -LiteralPath $input
    $before=(Get-FileHash -LiteralPath $file.FullName).Hash.ToLower()
    $doc=$null
    try {
      $doc=$word.Documents.Open($file.FullName,$false,$true,$false)
      $doc.Repaginate()
      $pages=$doc.ComputeStatistics(2)
      $text=$doc.Content.Text
      $pdf=Join-Path $out ($file.BaseName+'.word.pdf')
      $doc.ExportAsFixedFormat($pdf,17)
      $results.Add([pscustomobject]@{file=$file.Name;status='OPENED_EXPORTED_PENDING_PDF_CHECK';pages=$pages;bodyCharacters=$text.Length;sourceSha256=$before;pdf=[IO.Path]::GetFileName($pdf);pdfBytes=(Get-Item -LiteralPath $pdf).Length})
    } catch { $results.Add([pscustomobject]@{file=$file.Name;status='FAIL';error=$_.Exception.Message;sourceSha256=$before}) }
    finally { if($doc){$doc.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)} }
    if((Get-FileHash -LiteralPath $file.FullName).Hash.ToLower() -ne $before){throw 'Read-only source changed'}
    [pscustomobject]@{wordVersion=$word.Version;wordBuild=$word.Build;mode='Read-only; macro execution and external link updates disabled';documents=@($results.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'results.json') -Encoding utf8
    $results[$results.Count-1] | ConvertTo-Json -Compress
  }
} finally { if($word){$word.Quit(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}; [GC]::Collect();[GC]::WaitForPendingFinalizers() }
