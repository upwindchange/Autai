$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronDir = Join-Path $projectRoot "node_modules\electron"

# Resolve through any symlink/junction to the real directory
$electronModuleDir = (Get-Item $electronDir).Target
if (-not $electronModuleDir) {
  $electronModuleDir = $electronDir
} elseif ($electronModuleDir -is [array]) {
  $electronModuleDir = $electronModuleDir[0]
}
$pathFile = Join-Path $electronModuleDir "path.txt"
$distDir = Join-Path $electronModuleDir "dist"

function Test-ElectronInstalled {
  if (-not (Test-Path $pathFile)) {
    Write-Host "Electron path.txt not found, running install..."
    return $false
  }

  $pathContent = (Get-Content $pathFile -Raw).Trim()
  if (-not $pathContent) {
    Write-Host "Electron path.txt is empty, running install..."
    return $false
  }

  $executablePath = Join-Path $distDir $pathContent
  if (-not (Test-Path $executablePath)) {
    Write-Host "Electron executable not found, running install..."
    return $false
  }

  Write-Host "Electron installation is valid, skipping install..."
  return $true
}

function Install-Electron {
  $installScript = Join-Path $electronModuleDir "install.js"
  if (-not (Test-Path $installScript)) {
    Write-Error "Electron install script not found at: $installScript"
    exit 1
  }

  Write-Host "Running Electron install script..."
  Push-Location $electronModuleDir
  try {
    node $installScript 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Electron install script failed with exit code $LASTEXITCODE"
      exit 1
    }
  }
  finally {
    Pop-Location
  }

  # Verify installation after install.js
  if (Test-ElectronInstalled) {
    Write-Host "Electron install completed successfully"
    return
  }

  # install.js may have silently failed (e.g. antivirus blocking extract-zip).
  # Fall back to extracting the cached zip with PowerShell.
  Write-Host "Electron binary still missing after install.js, trying PowerShell fallback..."
  Repair-ElectronExtraction
}

function Repair-ElectronExtraction {
  # Find the cached zip
  $cacheDir = Join-Path $env:LOCALAPPDATA "electron\Cache"
  if (-not (Test-Path $cacheDir)) {
    # Try the older cache location
    $cacheDir = Join-Path $env:LOCALAPPDATA "electron\Cache"
  }

  # Read the electron version from package.json
  $pkgJson = Get-Content (Join-Path $electronModuleDir "package.json") -Raw | ConvertFrom-Json
  $version = $pkgJson.version
  $zipName = "electron-v${version}-win32-x64.zip"

  Write-Host "Looking for cached zip: $zipName"

  # Search cache subdirectories for the zip
  $zipPath = $null
  if (Test-Path $cacheDir) {
    # Check hash-named subdirectories first (newer @electron/get format)
    $subdirs = Get-ChildItem $cacheDir -Directory -ErrorAction SilentlyContinue
    foreach ($subdir in $subdirs) {
      $candidate = Join-Path $subdir.FullName $zipName
      if (Test-Path $candidate) {
        $zipPath = $candidate
        break
      }
    }

    # Also check top-level
    if (-not $zipPath) {
      $candidate = Join-Path $cacheDir $zipName
      if (Test-Path $candidate) {
        $zipPath = $candidate
      }
    }
  }

  if (-not $zipPath) {
    Write-Error "Could not find cached Electron zip. Try deleting node_modules and running pnpm install again."
    exit 1
  }

  Write-Host "Found cached zip: $zipPath"

  # Clear and recreate dist
  if (Test-Path $distDir) {
    Remove-Item $distDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $distDir -Force | Out-Null

  Write-Host "Extracting with PowerShell..."
  Expand-Archive -Path $zipPath -DestinationPath $distDir -Force

  # Write path.txt
  Set-Content -Path $pathFile -Value "electron.exe" -NoNewline
  Write-Host "Electron extraction completed successfully"
}

# --- Main ---

# 1. Install/verify Electron binary
if (-not (Test-ElectronInstalled)) {
  Install-Electron
} else {
  Write-Host "Electron postinstall check completed successfully"
}

# 2. Rebuild better-sqlite3 for Electron's Node ABI
Write-Host "Rebuilding better-sqlite3 for Electron..."
pnpm exec electron-rebuild -f -w better-sqlite3 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
  Write-Error "better-sqlite3 rebuild failed"
  exit 1
}
Write-Host "better-sqlite3 rebuild completed successfully"
