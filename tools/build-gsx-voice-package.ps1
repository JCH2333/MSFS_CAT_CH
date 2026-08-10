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

function Write-WavChunk([IO.BinaryWriter]$Writer, [string]$ChunkId, [byte[]]$Data) {
  $idBytes = [Text.Encoding]::ASCII.GetBytes($ChunkId)
  if ($idBytes.Length -ne 4) { throw "WAV chunk ID must contain exactly four ASCII characters: $ChunkId" }
  $Writer.Write($idBytes)
  $Writer.Write([uint32]$Data.Length)
  $Writer.Write($Data)
  if (($Data.Length % 2) -eq 1) { $Writer.Write([byte]0) }
}

function Normalize-WavFile([string]$SourcePath, [string]$DestinationPath) {
  $bytes = [IO.File]::ReadAllBytes($SourcePath)
  if ($bytes.Length -lt 12 -or
      [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF' -or
      [Text.Encoding]::ASCII.GetString($bytes, 8, 4) -ne 'WAVE') {
    throw "Invalid RIFF/WAVE file: $SourcePath"
  }

  $position = 12
  $fmt = $null
  $data = $null
  while ($position + 8 -le $bytes.Length) {
    $chunkId = [Text.Encoding]::ASCII.GetString($bytes, $position, 4)
    $chunkSize = [BitConverter]::ToUInt32($bytes, $position + 4)
    $chunkStart = $position + 8
    $chunkEnd = [int64]$chunkStart + $chunkSize
    if ($chunkEnd -gt $bytes.Length) {
      throw "WAV chunk exceeds file length: $SourcePath"
    }
    $chunkData = [byte[]]$bytes[$chunkStart..($chunkEnd - 1)]
    if ($chunkId -eq 'fmt ' -and $null -eq $fmt) { $fmt = $chunkData }
    if ($chunkId -eq 'data' -and $null -eq $data) { $data = $chunkData }
    $position = $chunkEnd
    if (($chunkSize % 2) -eq 1) { $position++ }
  }

  if ($null -eq $fmt -or $null -eq $data) {
    throw "WAV file is missing fmt or data chunk: $SourcePath"
  }

  $payload = New-Object IO.MemoryStream
  $writer = New-Object IO.BinaryWriter($payload, [Text.Encoding]::ASCII, $true)
  try {
    $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
    Write-WavChunk $writer 'fmt ' $fmt
    Write-WavChunk $writer 'data' $data
    $writer.Flush()
    $riffSize = [uint32]$payload.Length
    $output = New-Object IO.MemoryStream
    $outputWriter = New-Object IO.BinaryWriter($output, [Text.Encoding]::ASCII, $true)
    try {
      $outputWriter.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
      $outputWriter.Write($riffSize)
      $payload.Position = 0
      $payload.CopyTo($output)
      $outputWriter.Flush()
      [IO.File]::WriteAllBytes($DestinationPath, $output.ToArray())
    } finally {
      $outputWriter.Dispose()
      $output.Dispose()
    }
  } finally {
    $writer.Dispose()
    $payload.Dispose()
  }
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
    Normalize-WavFile $file.FullName $destination
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
