param(
  [string]$DownloadsPath = "C:\Users\bonam\Downloads",
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archivePattern = "skowt-assets-2026-08-04*.zip"
$archives = @(Get-ChildItem -LiteralPath $DownloadsPath -Filter $archivePattern -File | Sort-Object Name)
if ($archives.Count -eq 0) {
  throw "No Skowt archives matching $archivePattern were found in $DownloadsPath."
}

$categoryDirectories = @{
  "Artifacts" = "artifacts"
  "Food" = "food"
  "Items" = "items"
  "Splash Art" = "splash-art"
  "Weapon Icons" = "weapons"
}

$outputRoot = Join-Path $ProjectRoot "public\auto-draw\genshin"
$catalogPath = Join-Path $ProjectRoot "src\autoDraw\genshinCatalog.json"
$manifestPath = Join-Path $outputRoot "sources.json"
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null

function ConvertTo-Slug([string]$value) {
  $normalized = $value.Normalize([Text.NormalizationForm]::FormD)
  $builder = [Text.StringBuilder]::new()
  foreach ($character in $normalized.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$builder.Append($character)
    }
  }
  $slug = $builder.ToString().Normalize([Text.NormalizationForm]::FormC).ToLowerInvariant()
  $slug = [Regex]::Replace($slug, "[^a-z0-9]+", "-").Trim("-")
  if ([string]::IsNullOrWhiteSpace($slug)) { return "asset" }
  return $slug
}

function ConvertTo-Answer([string]$stem, [string]$category) {
  if ($category -ne "Splash Art") {
    return ([Regex]::Replace(($stem -replace "[_-]+", " "), "\s+", " ")).Trim().ToLowerInvariant()
  }

  $name = $stem.Trim()
  $name = [Regex]::Replace($name, "\s*\((portrait|edited)\)\s*$", "", "IgnoreCase")
  $name = [Regex]::Replace($name, "[- ]+(no[- ]?bg|no background)$", "", "IgnoreCase")
  $name = [Regex]::Replace($name, "\s+portrait$", "", "IgnoreCase")

  if ($name -match "(?i)(?:outfit|costume).*\s-\s(.+)$") {
    $name = $Matches[1]
  } elseif ($name -match "(?i)^(.+?)\s-\s.+(?:outfit|costume)$") {
    $name = $Matches[1]
  } elseif ($name -match "(?i)^(.+?)-(alternativeoutfit|skin(?:-.+)?)$") {
    $name = $Matches[1]
  }

  $specialAnswers = @{
    "blossoming starlight klee" = "klee"
    "ui costume ganyucostumeyu" = "ganyu"
    "ui costume shenhecostumedai" = "shenhe"
    "ui costume xingqiucostumebamboo" = "xingqiu"
    "ui gacha avatarimg liuyun" = "xianyun"
  }
  $key = ([Regex]::Replace(($name -replace "[_-]+", " "), "\s+", " ")).Trim().ToLowerInvariant()
  if ($specialAnswers.ContainsKey($key)) { return $specialAnswers[$key] }
  return $key
}

function Get-BytesHash([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant() }
  finally { $sha.Dispose() }
}

$catalog = [ordered]@{
  artifacts = @()
  food = @()
  items = @()
  splashArt = @()
  weapons = @()
}
$catalogKeys = @{
  "Artifacts" = "artifacts"
  "Food" = "food"
  "Items" = "items"
  "Splash Art" = "splashArt"
  "Weapon Icons" = "weapons"
}
$manifestAssets = [Collections.Generic.List[object]]::new()
$knownOutputHashes = @{}
$skippedDuplicates = [Collections.Generic.List[object]]::new()

foreach ($archive in $archives) {
  $zip = [IO.Compression.ZipFile]::OpenRead($archive.FullName)
  try {
    foreach ($entry in $zip.Entries) {
      if ([string]::IsNullOrWhiteSpace($entry.Name)) { continue }
      $parts = $entry.FullName -split "/"
      if ($parts.Count -lt 3 -or $parts[0] -ne "Genshin Impact") { continue }
      $category = $parts[1]
      if (-not $categoryDirectories.ContainsKey($category)) { continue }

      $extension = [IO.Path]::GetExtension($entry.Name).ToLowerInvariant()
      if ($extension -notin @(".png", ".jpg", ".jpeg", ".webp")) { continue }
      $originalStem = [IO.Path]::GetFileNameWithoutExtension($entry.Name)
      $baseName = ConvertTo-Slug $originalStem
      $directoryName = $categoryDirectories[$category]
      $targetDirectory = Join-Path $outputRoot $directoryName
      [IO.Directory]::CreateDirectory($targetDirectory) | Out-Null

      $stream = $entry.Open()
      try {
        $memory = [IO.MemoryStream]::new()
        try { $stream.CopyTo($memory); $bytes = $memory.ToArray() }
        finally { $memory.Dispose() }
      } finally { $stream.Dispose() }
      $hash = Get-BytesHash $bytes

      $candidateName = "$baseName$extension"
      $candidatePath = Join-Path $targetDirectory $candidateName
      $variant = 2
      while (Test-Path -LiteralPath $candidatePath) {
        $relativeCandidate = "$directoryName/$candidateName"
        if ($knownOutputHashes[$relativeCandidate] -eq $hash) {
          $skippedDuplicates.Add([ordered]@{ archive = $archive.Name; entry = $entry.FullName; duplicateOf = $relativeCandidate })
          $candidatePath = $null
          break
        }
        $candidateName = "$baseName-variant-$variant$extension"
        $candidatePath = Join-Path $targetDirectory $candidateName
        $variant++
      }
      if ($null -eq $candidatePath) { continue }

      [IO.File]::WriteAllBytes($candidatePath, $bytes)
      $relativeFile = "$directoryName/$candidateName"
      $knownOutputHashes[$relativeFile] = $hash
      $answer = ConvertTo-Answer $originalStem $category
      $idStem = ConvertTo-Slug "$directoryName-$([IO.Path]::GetFileNameWithoutExtension($candidateName))"
      $subject = [ordered]@{
        answer = $answer
        file = $candidateName
        id = "genshin-$idStem"
      }
      $catalog[$catalogKeys[$category]] += $subject
      $manifestAssets.Add([ordered]@{
        file = $relativeFile
        answer = $answer
        category = $category
        originalFile = $entry.FullName
        archive = $archive.Name
        sha256 = $hash
        copyrightOwner = "HoYoverse"
      })
    }
  } finally {
    $zip.Dispose()
  }
}

foreach ($key in @($catalog.Keys)) {
  $catalog[$key] = @($catalog[$key] | Sort-Object answer, file)
}

$manifest = [ordered]@{
  game = "Genshin Impact"
  source = "https://skowt.cc/games/genshin-impact"
  sourceType = "Community asset index"
  ownership = "Artwork and game assets are owned by HoYoverse. Skowt and Findraw do not claim ownership."
  importedOn = (Get-Date).ToString("yyyy-MM-dd")
  archives = @($archives.Name)
  importedFiles = $manifestAssets.Count
  skippedByteIdenticalDuplicates = @($skippedDuplicates)
  assets = @($manifestAssets)
}

$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($catalogPath, ($catalog | ConvertTo-Json -Depth 8), $utf8)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), $utf8)

[PSCustomObject]@{
  Archives = $archives.Count
  Imported = $manifestAssets.Count
  DuplicateCopiesSkipped = $skippedDuplicates.Count
  Artifacts = $catalog.artifacts.Count
  Food = $catalog.food.Count
  Items = $catalog.items.Count
  SplashArt = $catalog.splashArt.Count
  Weapons = $catalog.weapons.Count
  Output = $outputRoot
}
