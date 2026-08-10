param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\local-patches'),
  [string]$PatchVersion = '1.0.0'
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom([string]$FilePath, [string]$Contents) {
  [IO.File]::WriteAllText($FilePath, $Contents, (New-Object Text.UTF8Encoding($false)))
}

function Get-RelativePath([string]$Root, [string]$FilePath) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $fullPath = [IO.Path]::GetFullPath($FilePath)
  if (-not $fullPath.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the expected root: $FilePath"
  }
  return $fullPath.Substring($rootPath.Length + 1)
}

$source = (Resolve-Path -LiteralPath $SourceRoot).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
$work = Join-Path ([IO.Path]::GetTempPath()) ('msfs-cat-ch-gsx-voice-' + [guid]::NewGuid().ToString('N'))
$payloadRoot = Join-Path $work 'payload'
$soundsRoot = Join-Path $payloadRoot 'sounds'
$archive = Join-Path $output "msfs-cat-ch-gsx-pro-zh-cn-voice-v$PatchVersion.zip"
$fingerprintPath = Join-Path $output "msfs-cat-ch-gsx-pro-zh-cn-voice-v$PatchVersion.fingerprint.json"

try {
  $wavFiles = @(Get-ChildItem -LiteralPath $source -Recurse -File -Filter '*.wav')
  if ($wavFiles.Count -eq 0) { throw "No WAV files found under: $source" }

  $unexpected = @(Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object { $_.Extension -notin @('.wav', '.bak') })
  if ($unexpected.Count -gt 0) {
    throw "Source directory contains a non-WAV file: $($unexpected[0].FullName)"
  }

  New-Item -ItemType Directory -Force -Path $soundsRoot, $output | Out-Null
  foreach ($file in $wavFiles) {
    $relative = Get-RelativePath $source $file.FullName
    $destination = Join-Path $soundsRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }

  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $archive -CompressionLevel Optimal

  $zipArchive = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $invalidEntry = $zipArchive.Entries | Where-Object {
      $entryPath = $_.FullName.Replace('\', '/')
      $entryPath -and ($entryPath -notmatch '^sounds/' -or $entryPath -notmatch '\.wav$')
    } | Select-Object -First 1
    if ($invalidEntry) { throw "Generated ZIP contains an unexpected entry: $($invalidEntry.FullName)" }
  } finally {
    $zipArchive.Dispose()
  }

  $fingerprint = foreach ($file in (Get-ChildItem -LiteralPath $soundsRoot -Recurse -File -Filter '*.wav')) {
    [pscustomobject]@{
      relativePath = ('sounds/' + (Get-RelativePath $soundsRoot $file.FullName).Replace('\', '/'))
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  Write-Utf8NoBom $fingerprintPath ($fingerprint | ConvertTo-Json -Depth 4)

  [pscustomobject]@{
    archive = $archive
    fingerprint = $fingerprintPath
    files = $fingerprint.Count
    archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    archiveSize = (Get-Item -LiteralPath $archive).Length
  } | ConvertTo-Json
} finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
