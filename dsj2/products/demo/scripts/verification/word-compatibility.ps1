param(
  [Parameter(Mandatory=$true)][string]$InputDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string]$PythonPath,
  [string]$ReferencePdfDirectory,
  [string]$TemporaryFontDirectory,
  [int]$ExpectedDocumentCount=20
)
$ErrorActionPreference = 'Stop'
$inputRoot = (Resolve-Path -LiteralPath $InputDirectory).Path
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$auditScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../docs/evidence/commercial-acceptance/word/audit-word-pdf.py')).Path
$canonical = '^(biot-worker-card|biot-itr-certificate|biot-protocol|ps-card|ps-protocol|ps-witness|ptm-card|ptm-protocol|pb-card|pb-protocol)-(short|long)\.docx$'
$files = @(Get-ChildItem -LiteralPath $inputRoot -File | Where-Object { $_.Name -match $canonical } | Sort-Object Name)
if($files.Count -ne $ExpectedDocumentCount){throw "Expected $ExpectedDocumentCount canonical short/long documents; found $($files.Count). Exploratory files are excluded."}
& $PythonPath -c 'import pdfplumber'
if($LASTEXITCODE -ne 0){throw 'The selected Python must provide pdfplumber before Word is started.'}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$results = [Collections.Generic.List[object]]::new()
$word = $null
$previousUpdateLinks=$null
$ownEmptyInstance=$false
$loadedFonts=[Collections.Generic.List[object]]::new()
$fontManifest=$null
try {
  if($TemporaryFontDirectory){
    if(-not ('DemoWordFontSession' -as [type])){
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DemoWordFontSession {
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int AddFontResourceExW(string path, uint flags, IntPtr reserved);
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern bool RemoveFontResourceExW(string path, uint flags, IntPtr reserved);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
    }
    $fontRoot=(Resolve-Path -LiteralPath $TemporaryFontDirectory).Path
    $fontManifest=Get-Content -LiteralPath (Join-Path $fontRoot 'manifest.json') -Raw | ConvertFrom-Json
    foreach($font in @(Get-ChildItem -LiteralPath $fontRoot -File | Where-Object {$_.Name -match '^Liberation(Serif|Sans)-.*\.ttf$'})){
      $hash=(Get-FileHash -LiteralPath $font.FullName).Hash.ToLower()
      if($fontManifest.files.($font.Name) -ne $hash){throw "Font checksum mismatch: $($font.Name)"}
      $count=[DemoWordFontSession]::AddFontResourceExW($font.FullName,0,[IntPtr]::Zero)
      if($count -eq 0){throw "Cannot register session font: $($font.Name)"}
      $loadedFonts.Add([pscustomobject]@{file=$font.Name;path=$font.FullName;sha256=$hash;added=$count;removed=$false})
    }
    [UIntPtr]$fontMessageResult=[UIntPtr]::Zero
    [void][DemoWordFontSession]::SendMessageTimeoutW([IntPtr]0xffff,0x001d,[UIntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$fontMessageResult)
  }
  $word = New-Object -ComObject Word.Application
  if($word.Documents.Count -ne 0){throw 'Word has open documents; verification will not close or change them.'}
  $ownEmptyInstance=$true
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $previousUpdateLinks=$word.Options.UpdateLinksAtOpen
  $word.Options.UpdateLinksAtOpen = $false
  $version = $word.Version
  $build = $word.Build
  foreach ($file in $files) {
    $doc = $null
    $before = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    try {
      $doc = $word.Documents.Open($file.FullName, $false, $true, $false)
      $doc.Repaginate()
      $pages = $doc.ComputeStatistics(2)
      $pdf = Join-Path $outputRoot ($file.BaseName + '.word.pdf')
      $textPath=Join-Path $outputRoot ($file.BaseName + '.word-body.txt')
      $auditPath=Join-Path $outputRoot ($file.BaseName + '.audit.json')
      $allText=[Collections.Generic.List[string]]::new()
      foreach($story in $doc.StoryRanges){
        $range=$story
        while($null -ne $range){$allText.Add($range.Text);$range=$range.NextStoryRange}
      }
      [IO.File]::WriteAllText($textPath,($allText -join "`n"),[Text.UTF8Encoding]::new($false))
      $doc.ExportAsFixedFormat($pdf, 17)
      $auditArgs=@('-X','utf8',$auditScript,'--source',$file.FullName,'--pdf',$pdf,'--word-pages',"$pages",'--word-text',$textPath,'--output',$auditPath)
      if($ReferencePdfDirectory){$auditArgs+=@('--reference-pdf',(Join-Path $ReferencePdfDirectory ($file.BaseName+'.pdf')))}
      & $PythonPath @auditArgs | Out-Host
      $auditExit=$LASTEXITCODE
      if(-not (Test-Path -LiteralPath $auditPath)){throw "PDF audit did not produce a result, exit $auditExit"}
      $audit=Get-Content -LiteralPath $auditPath -Raw | ConvertFrom-Json
      if($auditExit -ne 0 -or $audit.status -ne 'PASS'){throw "PDF structural/text audit failed: $($audit.errors -join ', ')"}
      $results.Add([pscustomobject]@{file=$file.Name;status='PASS';pages=$pages;pdfPages=$audit.pdfPages;expectedWords=$audit.expectedUniqueWords;pdf=[IO.Path]::GetFileName($pdf);audit=[IO.Path]::GetFileName($auditPath);docxSha256=$before.ToLower();pdfSha256=$audit.pdfSha256;visualReview='REQUIRED_SEPARATELY'})
    } catch {
      $results.Add([pscustomobject]@{file=$file.Name;status='FAIL';error=$_.Exception.Message;docxSha256=$before.ToLower()})
    } finally {
      if ($doc) { $doc.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc) }
    }
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $before) { throw "Source changed during read-only Word verification: $($file.Name)" }
    [pscustomobject]@{wordVersion=$version;wordBuild=$build;mode='read-only; macros disabled; no links update; canonical filenames only; PDF page/text comparison required';expectedDocuments=$ExpectedDocumentCount;documents=@($results.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputRoot 'word-results.json') -Encoding utf8
    Write-Output "$($results[$results.Count-1].status): $($file.Name)"
  }
} finally {
  if ($word) { if($ownEmptyInstance){if($null -ne $previousUpdateLinks){$word.Options.UpdateLinksAtOpen=$previousUpdateLinks};$word.Quit(0)}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  if($loadedFonts.Count -gt 0){
    foreach($font in $loadedFonts){$font.removed=[DemoWordFontSession]::RemoveFontResourceExW($font.path,0,[IntPtr]::Zero)}
    [UIntPtr]$fontMessageResult=[UIntPtr]::Zero
    [void][DemoWordFontSession]::SendMessageTimeoutW([IntPtr]0xffff,0x001d,[UIntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$fontMessageResult)
    [pscustomobject]@{version=$fontManifest.version;mode='session scope, registry-less AddFontResourceExW flags=0; removed after Word exits';fonts=@($loadedFonts.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'font-session.json') -Encoding utf8
    if(@($loadedFonts | Where-Object {-not $_.removed}).Count -gt 0){throw 'Temporary font cleanup failed; see font-session.json.'}
  }
}
if(@($results | Where-Object {$_.status -ne 'PASS'}).Count -gt 0){exit 1}
