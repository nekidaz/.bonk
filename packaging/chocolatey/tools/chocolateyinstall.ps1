$ErrorActionPreference = 'Stop'

$packageName = 'bonk'
$url64 = '__URL64__'
$checksum64 = '__CHECKSUM64__'
$fileType = if ($url64 -match '\.msi($|\?)') { 'msi' } else { 'exe' }
$silentArgs = if ($fileType -eq 'msi') { '/qn /norestart' } else { '/S' }

Install-ChocolateyPackage `
  -PackageName $packageName `
  -FileType $fileType `
  -SilentArgs $silentArgs `
  -Url64bit $url64 `
  -Checksum64 $checksum64 `
  -ChecksumType64 'sha256'
