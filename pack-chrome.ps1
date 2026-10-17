$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP ("tsc-chrome-" + [guid]::NewGuid().ToString("n"))
$dist = Join-Path $root "dist"
$zipPath = Join-Path $dist "trade-script-converter-chrome.zip"

New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$include = @(
  "manifest.json",
  "background.js",
  "config.js",
  "content.js",
  "page-bridge.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js"
)
foreach ($name in $include) {
  Copy-Item (Join-Path $root $name) (Join-Path $stage $name)
}
Copy-Item (Join-Path $root "icons") (Join-Path $stage "icons") -Recurse

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $entry = $_.FullName.Substring($stage.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry) | Out-Null
  }
}
finally {
  $zip.Dispose()
  Remove-Item $stage -Recurse -Force
}

Write-Output $zipPath
