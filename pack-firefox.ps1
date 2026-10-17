$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP ("tsc-firefox-" + [guid]::NewGuid().ToString("n"))
$dist = Join-Path $root "dist"
$xpi = Join-Path $dist "trade-script-converter-firefox.xpi"

New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$include = @(
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

$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$manifest.PSObject.Properties.Remove("key")
$manifest.PSObject.Properties.Remove("side_panel")
$manifest.permissions = @($manifest.permissions | Where-Object { $_ -ne "sidePanel" })
$manifest | Add-Member -NotePropertyName background -NotePropertyValue ([pscustomobject]@{
  scripts = @("background.js")
  type = "module"
}) -Force
$manifest | Add-Member -NotePropertyName sidebar_action -NotePropertyValue ([pscustomobject]@{
  default_title = "Trade Script Converter"
  default_panel = "sidepanel.html"
  default_icon = [pscustomobject]@{
    "16" = "icons/icon16.png"
    "48" = "icons/icon48.png"
  }
  open_at_install = $false
}) -Force
$manifest | Add-Member -NotePropertyName browser_specific_settings -NotePropertyValue ([pscustomobject]@{
  gecko = [pscustomobject]@{
    id = "trade-script-converter@profitrobots.com"
    strict_min_version = "128.0"
  }
}) -Force
$json = $manifest | ConvertTo-Json -Depth 8
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $stage "manifest.json"), $json, $utf8)

if (Test-Path $xpi) {
  Remove-Item $xpi -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($xpi, [System.IO.Compression.ZipArchiveMode]::Create)
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

Write-Output $xpi
