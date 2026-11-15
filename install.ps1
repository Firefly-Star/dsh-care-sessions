# dsh-care-sessions: wire the plugin into a DSH profile.
#
# Three steps, each one checks before it acts and stops on failure:
#
#   1. Wire the plugin into the profile: dependencies + dsh.profile.bundles,
#      then link the package into the profile's node_modules.
#   2. Verify the link really is a reparse point that reaches the entry file.
#   3. Report what to do next (refresh the page; restart only if HMR is off).
#
# Why this exists as a script: writing ~/.dsh is outside the agent's DSH file
# sandbox (workspace-write). Either the user runs this by hand in a normal
# PowerShell window, or the agent runs it under an explicit approval.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#
#   -ProfileDir <path>   profile to install into (default ~/.dsh/profiles/web)
#   -PluginDir  <path>   plugin source     (defaults to this script's folder)
#   -DryRun              report what would happen, change nothing
#   -Uninstall           remove the plugin from the profile instead
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less file as ANSI,
# so a CJK literal in a .ps1 breaks the parse. Docs stay Chinese, code stays
# ASCII. Keep it that way.

[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
    [string]$PluginDir = '',
    [switch]$DryRun,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$PluginName = 'dsh-care-sessions'

# $PSScriptRoot is empty while parameter defaults are bound in Windows
# PowerShell 5.1, so the script's own folder is resolved here instead.
if ([string]::IsNullOrWhiteSpace($PluginDir)) {
    $PluginDir = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($PluginDir)) {
        $PluginDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    }
}

function Say  { param([string]$Text) Write-Host $Text }
function Ok   { param([string]$Text) Write-Host "[ OK ] $Text" -ForegroundColor Green }
function Warn { param([string]$Text) Write-Host "[WARN] $Text" -ForegroundColor Yellow }
function Fail { param([string]$Text) Write-Host "[FAIL] $Text" -ForegroundColor Red; exit 1 }
function Step { param([string]$Text) Write-Host "`n--- $Text ---" -ForegroundColor Cyan }

# --- 0. preflight -----------------------------------------------------------
Step 'preflight'

if (-not (Test-Path -LiteralPath $PluginDir)) { Fail "plugin directory not found: $PluginDir" }
$PluginDir = (Resolve-Path -LiteralPath $PluginDir).Path
$manifestPath = Join-Path $PluginDir 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { Fail "plugin manifest not found: $manifestPath" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne $PluginName) { Fail "unexpected plugin name: $($manifest.name)" }
Ok "plugin $($manifest.name)@$($manifest.version) at $PluginDir"

foreach ($entry in @('index.js', 'client.js', 'cordis.patch.yml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PluginDir $entry))) { Fail "missing entry file: $entry" }
}
Ok 'entry files present'

if (-not (Test-Path -LiteralPath $ProfileDir)) { Fail "profile directory not found: $ProfileDir" }
$profileManifestPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path -LiteralPath $profileManifestPath)) { Fail "profile manifest not found: $profileManifestPath" }
Ok "profile at $ProfileDir"

# --- 1. wire (or unwire) the profile manifest -------------------------------
$linkPath = Join-Path $ProfileDir "node_modules\$PluginName"

if ($Uninstall) {
    Step 'uninstall'
    if ($DryRun) {
        Say "would remove dependency + bundle row for $PluginName"
        Say "would remove $linkPath"
        Say 'done (dry run)'
        exit 0
    }

    $original = Get-Content -LiteralPath $profileManifestPath -Raw -Encoding UTF8
    $backup = "$profileManifestPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $profileManifestPath -Destination $backup
    Ok "backup: $backup"

    $parsed = $original | ConvertFrom-Json
    # Rebuild the object rather than text-editing: removal has to touch two
    # separate places (a dependency key and an array element), and a partial
    # edit would leave a profile that boots to a missing module.
    $deps = [ordered]@{}
    foreach ($property in $parsed.dependencies.PSObject.Properties) {
        if ($property.Name -ne $PluginName) { $deps[$property.Name] = $property.Value }
    }
    $bundles = @($parsed.dsh.profile.bundles | Where-Object { $_ -ne $PluginName })
    $parsed.dependencies = [pscustomobject]$deps
    $parsed.dsh.profile.bundles = $bundles
    $json = $parsed | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($profileManifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Ok 'profile manifest updated'

    if (Test-Path -LiteralPath $linkPath) {
        Remove-Item -LiteralPath $linkPath -Recurse -Force
        Ok "removed $linkPath"
    }
    Say ''
    Ok 'uninstalled.'
    exit 0
}

Step 'wire plugin into profile'

$original = Get-Content -LiteralPath $profileManifestPath -Raw -Encoding UTF8
$parsed = $original | ConvertFrom-Json

$alreadyDependency = $parsed.dependencies.PSObject.Properties.Name -contains $PluginName
$alreadyBundle = @($parsed.dsh.profile.bundles) -contains $PluginName

if ($alreadyDependency -and $alreadyBundle) {
    Ok 'already wired (dependencies + bundles)'
}
elseif ($DryRun) {
    Say "would add dependency $PluginName -> $PluginDir"
    Say "would append $PluginName to dsh.profile.bundles"
}
else {
    # Edit the JSON text rather than round-tripping the object: a ConvertTo-Json
    # round trip would reorder keys and rewrite unrelated formatting in a file
    # the user maintains by hand.
    $backup = "$profileManifestPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $profileManifestPath -Destination $backup
    Ok "backup: $backup"

    $text = $original
    if (-not $alreadyDependency) {
        $urlPath = ($PluginDir -replace '\\', '/')
        $text = $text -replace '("dependencies"\s*:\s*\{)', "`$1`n    `"$PluginName`": `"file:///$urlPath`","
    }
    if (-not $alreadyBundle) {
        $text = $text -replace '("bundles"\s*:\s*\[)([^\]]*?)(\s*\])', "`$1`$2,`n        `"$PluginName`"`$3"
    }
    # Parse before writing: never leave invalid JSON behind in a live profile.
    $check = $text | ConvertFrom-Json
    if (-not $check.dependencies.PSObject.Properties.Name.Contains($PluginName)) { Fail 'dependency edit did not apply' }
    if (-not (@($check.dsh.profile.bundles) -contains $PluginName)) { Fail 'bundle edit did not apply' }
    [System.IO.File]::WriteAllText($profileManifestPath, $text, (New-Object System.Text.UTF8Encoding($false)))
    Ok 'profile manifest updated'
}

# --- 2. node_modules link ---------------------------------------------------
# DSH discovers profile plugins with `dirent.isSymbolicLink()`, and a junction
# created after the target directory already exists would be a plain directory
# instead (link silently ignored). So: create the link first, then verify it
# really is a reparse point.
Step 'link the package into node_modules'

$linkIsReal = $false
if (Test-Path -LiteralPath $linkPath) {
    $item = Get-Item -LiteralPath $linkPath -Force
    $linkIsReal = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

if ($linkIsReal) {
    Ok "link exists: $linkPath"
}
elseif ($DryRun) {
    Say "would create junction $linkPath -> $PluginDir"
}
else {
    if (Test-Path -LiteralPath $linkPath) {
        Warn 'existing entry is a plain directory, replacing it with a junction'
        Remove-Item -LiteralPath $linkPath -Recurse -Force
    }
    $modulesDir = Join-Path $ProfileDir 'node_modules'
    New-Item -ItemType Directory -Path $modulesDir -Force | Out-Null
    # cmd's mklink is used on purpose: New-Item -ItemType Junction can no-op
    # against an existing path, which is exactly the failure seen before.
    & cmd /c "mklink /J `"$linkPath`" `"$PluginDir`"" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "mklink failed for $linkPath" }

    $item = Get-Item -LiteralPath $linkPath -Force
    if ((($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)) {
        Fail "link was not created as a reparse point: $linkPath"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $linkPath 'client.js'))) {
        Fail "link does not reach the plugin entry: $linkPath"
    }
    Ok "linked $linkPath -> $PluginDir"
}

# --- 3. next step -----------------------------------------------------------
Step 'done'
Say ''
Say "  $PluginName is wired into $ProfileDir"
Say ''
Say '  Reload the DSH web page. With HMR enabled in the profile the new bundle'
Say '  joins the running composition; without it, restart the DSH process.'
Say ''
Say '  Then look at the Workspace section header row in the left sidebar: a'
Say '  star joins the search / view / add buttons. Sessions gain a star in'
Say '  their hover strip and one row in their "..." menu.'
