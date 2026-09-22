param([Parameter(Mandatory=$true)][string]$DocumentPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName WindowsBase
Add-Type -Path 'C:/Program Files/Microsoft Office/root/vfs/Windows/assembly/GAC_MSIL/DocumentFormat.OpenXml/2.8.1.0__8FB06CB64D019A17/DocumentFormat.OpenXml.dll'
$document = [DocumentFormat.OpenXml.Packaging.WordprocessingDocument]::Open((Resolve-Path -LiteralPath $DocumentPath).Path,$false)
try {
  $validator = New-Object DocumentFormat.OpenXml.Validation.OpenXmlValidator([DocumentFormat.OpenXml.FileFormatVersions]::Office2016)
  $errors = @($validator.Validate($document) | ForEach-Object { [pscustomobject]@{ description=$_.Description; path=$_.Path.XPath; part=$_.Part.Uri.ToString() } })
  ConvertTo-Json -InputObject $errors -Depth 4 | Set-Content -Encoding utf8 -LiteralPath $OutputPath
  Write-Output ('Validation errors: '+$errors.Count)
} finally { $document.Dispose() }
