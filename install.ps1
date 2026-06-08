#!/usr/bin/env pwsh
#Requires -Version 5.1

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $PSCommandPath
$REPO_ROOT = $SCRIPT_DIR
$PLUGIN_NAME = "opencode-rag-plugin"
$CLI_BIN_DIR = Join-Path (Join-Path $env:USERPROFILE ".local") "bin"
$GLOBAL_CONFIG = Join-Path (Join-Path $env:USERPROFILE ".config") "opencode"
$RUNTIME_DIR = Join-Path $env:USERPROFILE ".opencode"

# --- helpers ------------------------------------------------------------------

function die {
    param([string]$Message)
    Write-Host "Error: $Message" -ForegroundColor Red
    exit 1
}

function info { Write-Host "  $($args -join ' ')" }

function step { Write-Host "`n$($args -join ' ')" }

function ok { Write-Host "  $($args[0])  OK" -ForegroundColor Green }

function fail_msg { Write-Host "  $($args[0])  FAILED" -ForegroundColor Red }

function ensure_user_path_contains {
    param([string]$Dir)

    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
        return $false
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($userPath)) {
        [Environment]::SetEnvironmentVariable("Path", $Dir, "User")
        return $true
    }

    $entries = $userPath -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 }
    foreach ($entry in $entries) {
        if ($entry.TrimEnd('\\') -ieq $Dir.TrimEnd('\\')) {
            return $false
        }
    }

    [Environment]::SetEnvironmentVariable("Path", "$userPath;$Dir", "User")
    return $true
}

function test_node_resolution {
    param(
        [string]$ModuleName,
        [string]$BaseDir
    )

    & node -e "const moduleName=process.argv[1];const baseDir=process.argv[2];try{require.resolve(moduleName,{paths:[baseDir]});}catch{process.exit(1);}" -- $ModuleName $BaseDir 2>$null
    return ($LASTEXITCODE -eq 0)
}

function cleanup_tgz {
    Remove-Item -Path "$GLOBAL_CONFIG\$PLUGIN_NAME-*.tgz" -Force -ErrorAction SilentlyContinue
}

function remove_from_npm {
    param([string]$dir)
    $pkg = Join-Path $dir "package.json"
    $pluginDir = Join-Path $dir "node_modules" $PLUGIN_NAME
    Remove-Item -Path $pluginDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $pkg -PathType Leaf) {
        node -e @'
            const fs = require("fs");
            const p = process.argv[2];
            const name = process.argv[3];
            const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
            if (pkg.dependencies && pkg.dependencies[name]) {
                delete pkg.dependencies[name];
            }
            fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
'@ $pkg $PLUGIN_NAME
        Push-Location $dir
        & cmd /c "npm prune --prefix `"$dir`" --silent 2>nul"
        Pop-Location
    }
}

function remove_from_config {
    foreach ($cfg in @("opencode.jsonc", "opencode.json")) {
        $cfgpath = Join-Path $GLOBAL_CONFIG $cfg
        if (-not (Test-Path -LiteralPath $cfgpath -PathType Leaf)) { continue }
        node -e @'
            const fs = require("fs");
            const cfgPath = process.argv[2];
            const name = process.argv[3];
            const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
            if (c.plugin) {
                c.plugin = c.plugin.filter(p => p !== name);
                if (c.plugin.length === 0) delete c.plugin;
            }
            fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2) + "\n");
'@ $cfgpath $PLUGIN_NAME
        info "Removed $PLUGIN_NAME from $cfgpath"
    }
}

# --- preflight checks ---------------------------------------------------------

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    die "npm is required but was not found in PATH"
}

if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    die "opencode is required but was not found in PATH"
}

# --- uninstall ---------------------------------------------------------------

if ($args[0] -eq "uninstall") {
    step "Uninstalling $PLUGIN_NAME..."
    Remove-Item -Path "$CLI_BIN_DIR\opencode-rag.ps1" -Force -ErrorAction SilentlyContinue
    remove_from_npm $GLOBAL_CONFIG
    remove_from_npm $RUNTIME_DIR
    cleanup_tgz
    remove_from_config
    Remove-Item -Path "$REPO_ROOT\.opencode\plugins\rag-plugin.js" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$REPO_ROOT\.opencode\plugins\package.json" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$REPO_ROOT\.opencode\plugins" -Force -ErrorAction SilentlyContinue
    step "Uninstalled. Restart OpenCode if it is running."
    exit 0
}

# --- install -----------------------------------------------------------------

Set-Location $REPO_ROOT

$distPath = Join-Path $REPO_ROOT "dist"
if (Test-Path -LiteralPath $distPath -PathType Container) {
    step "Building $PLUGIN_NAME..."
    & cmd /c "npm run build"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Build failed but dist/ exists, continuing with existing build..." -ForegroundColor Yellow
    }
}
else {
    step "Building $PLUGIN_NAME..."
    & cmd /c "npm run build"
    if ($LASTEXITCODE -ne 0) { die "npm run build failed" }
}

step "Packing plugin..."
New-Item -ItemType Directory -Path $GLOBAL_CONFIG -Force | Out-Null
cleanup_tgz

$packOutput = & cmd /c "npm pack --pack-destination `"$GLOBAL_CONFIG`" 2>nul"
if ($LASTEXITCODE -ne 0) { die "npm pack failed to produce a .tgz file" }
$PACKED = ($packOutput | Select-Object -Last 1).Trim()
if (-not $PACKED -or -not (Test-Path -LiteralPath "$GLOBAL_CONFIG\$PACKED" -PathType Leaf)) {
    die "npm pack failed to produce a .tgz file"
}
info "Packed: $GLOBAL_CONFIG\$PACKED"

function install_plugin {
    param([string]$targetDir, [string]$packPath)
    $output = & cmd /c "npm install --prefix `"$targetDir`" --silent `"$packPath`" 2>nul"
    if ($LASTEXITCODE -eq 0) { return $true }
    # Retry with --ignore-scripts for native modules (canvas) on Windows
    Write-Host "  Retrying without native module compilation..." -ForegroundColor Yellow
    $output = & cmd /c "npm install --prefix `"$targetDir`" --silent --ignore-scripts --no-optional `"$packPath`" 2>nul"
    return ($LASTEXITCODE -eq 0)
}

# Install into opencode runtime node_modules
step "Installing into OpenCode runtime ($RUNTIME_DIR)..."
New-Item -ItemType Directory -Path $RUNTIME_DIR -Force | Out-Null
if (-not (install_plugin $RUNTIME_DIR "$GLOBAL_CONFIG\$PACKED")) {
    die "npm install into runtime failed"
}

$runtimeDist = Join-Path (Join-Path (Join-Path $RUNTIME_DIR "node_modules") $PLUGIN_NAME) "dist"
if (Test-Path -LiteralPath $runtimeDist -PathType Container) {
    ok "Runtime node_modules"
}
else {
    fail_msg "Runtime node_modules"
    die "$PLUGIN_NAME not found in $RUNTIME_DIR\node_modules\"
}

# Install into config node_modules
step "Installing into OpenCode config ($GLOBAL_CONFIG)..."
if (-not (install_plugin $GLOBAL_CONFIG "$GLOBAL_CONFIG\$PACKED")) {
    die "npm install into config failed"
}

$configDist = Join-Path (Join-Path (Join-Path $GLOBAL_CONFIG "node_modules") $PLUGIN_NAME) "dist"
if (Test-Path -LiteralPath $configDist -PathType Container) {
    ok "Config node_modules"
}
else {
    fail_msg "Config node_modules"
    die "$PLUGIN_NAME not found in $GLOBAL_CONFIG\node_modules\"
}

# Register plugin in opencode config
step "Registering plugin with OpenCode..."
$jsoncPath = Join-Path $GLOBAL_CONFIG "opencode.jsonc"
$jsonPath = Join-Path $GLOBAL_CONFIG "opencode.json"

if (Test-Path -LiteralPath $jsoncPath -PathType Leaf) {
    if (Select-String -LiteralPath $jsoncPath -Pattern '"opencode-rag-plugin"' -Quiet) {
        info "$PLUGIN_NAME already registered in opencode.jsonc"
    }
    else {
        node -e @'
            const fs = require("fs");
            const cfgPath = process.argv[2];
            const name = process.argv[3];
            const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
            c.plugin = c.plugin || [];
            if (!c.plugin.includes(name)) {
                c.plugin.push(name);
            }
            fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2) + "\n");
'@ $jsoncPath $PLUGIN_NAME
        ok "Added $PLUGIN_NAME to opencode.jsonc"
    }
}
elseif (Test-Path -LiteralPath $jsonPath -PathType Leaf) {
    if (Select-String -LiteralPath $jsonPath -Pattern '"opencode-rag-plugin"' -Quiet) {
        info "$PLUGIN_NAME already registered in opencode.json"
    }
    else {
        node -e @'
            const fs = require("fs");
            const cfgPath = process.argv[2];
            const name = process.argv[3];
            const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
            c.plugin = c.plugin || [];
            if (!c.plugin.includes(name)) {
                c.plugin.push(name);
            }
            fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2) + "\n");
'@ $jsonPath $PLUGIN_NAME
        ok "Added $PLUGIN_NAME to opencode.json"
    }
}
else {
    @"
{
  "`$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_NAME"]
}
"@ | Set-Content -LiteralPath $jsoncPath -Encoding UTF8
    ok "Created opencode.jsonc with $PLUGIN_NAME"
}

# Clean up .tgz
cleanup_tgz

# Also register via opencode CLI
& cmd /c "opencode plugin $PLUGIN_NAME --global >nul 2>&1"

# Create CLI wrapper
step "Making CLI available on PATH..."
New-Item -ItemType Directory -Path $CLI_BIN_DIR -Force | Out-Null
Remove-Item -Path "$CLI_BIN_DIR\opencode-rag.ps1" -Force -ErrorAction SilentlyContinue
@"
& node "$RUNTIME_DIR\node_modules\$PLUGIN_NAME\dist\cli.js" @args
"@ | Set-Content -LiteralPath "$CLI_BIN_DIR\opencode-rag.ps1" -Encoding UTF8
ok "$CLI_BIN_DIR\opencode-rag.ps1"

$pathUpdated = ensure_user_path_contains $CLI_BIN_DIR
if ($pathUpdated) {
    info "Added $CLI_BIN_DIR to your user PATH"
}

# Clean up old workspace-local wrappers (legacy)
Remove-Item -Path "$REPO_ROOT\.opencode\plugins\rag-plugin.js" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$REPO_ROOT\.opencode\plugins\package.json" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$REPO_ROOT\.opencode\plugins" -Force -ErrorAction SilentlyContinue

# --- verification ------------------------------------------------------------

step "Verifying installation..."

$verified = $true

$runtimeEntry = Join-Path (Join-Path (Join-Path (Join-Path $RUNTIME_DIR "node_modules") $PLUGIN_NAME) "dist") "plugin-entry.js"
if (Test-Path -LiteralPath $runtimeEntry -PathType Leaf) {
    ok "Runtime plugin entry"
}
else {
    fail_msg "Runtime plugin entry"; $verified = $false
}

$configEntry = Join-Path (Join-Path (Join-Path (Join-Path $GLOBAL_CONFIG "node_modules") $PLUGIN_NAME) "dist") "plugin-entry.js"
if (Test-Path -LiteralPath $configEntry -PathType Leaf) {
    ok "Config plugin entry"
}
else {
    fail_msg "Config plugin entry"; $verified = $false
}

$cliPath = "$CLI_BIN_DIR\opencode-rag.ps1"
if (Test-Path -LiteralPath $cliPath -PathType Leaf) {
    ok "CLI wrapper"
}
else {
    fail_msg "CLI wrapper"; $verified = $false
}

# Node resolution check (runtime)
if (test_node_resolution $PLUGIN_NAME $RUNTIME_DIR) {
    ok "Node resolution (runtime)"
}
else {
    fail_msg "Node resolution (runtime)"; $verified = $false
}

# Node resolution check (config)
if (test_node_resolution $PLUGIN_NAME $GLOBAL_CONFIG) {
    ok "Node resolution (config)"
}
else {
    fail_msg "Node resolution (config)"; $verified = $false
}

step ""
if ($verified) {
    Write-Host "Installation complete!" -ForegroundColor Green
}
else {
    Write-Host "Installation finished with warnings (see above)." -ForegroundColor Yellow
}

Write-Host "`nWhat to do next:"
Write-Host "  1. Restart OpenCode if it is running."
Write-Host "  2. In any workspace where you want RAG context, run 'opencode-rag init'."
Write-Host "     This bootstraps opencode-rag.json and the workspace-local .opencode files."
Write-Host "  3. Run 'opencode-rag index' from that workspace to index its files."
Write-Host "  4. OpenCode will automatically use the indexed data for context-aware queries."
if ($pathUpdated) {
    Write-Host "  5. In your current PowerShell session run: `$env:Path += ';$CLI_BIN_DIR'"
}
Write-Host "`nRun '$PSCommandPath uninstall' to remove."
