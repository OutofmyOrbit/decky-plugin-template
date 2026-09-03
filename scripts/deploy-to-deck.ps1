[CmdletBinding()]
param(
    [string]$HostName = "192.168.86.62",
    [string]$User = "deck",
    [int]$Port = 22,
    [string]$IdentityFile,
    [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

function Assert-LastExitCode {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

$rootDir = Split-Path -Parent $PSScriptRoot
$plugin = Get-Content (Join-Path $rootDir "plugin.json") -Raw | ConvertFrom-Json
$pluginName = $plugin.name
$zipPath = Join-Path $rootDir "out\$pluginName.zip"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue) -or -not (Get-Command scp -ErrorAction SilentlyContinue)) {
    throw "OpenSSH client tools (ssh and scp) are required. Install the Windows OpenSSH Client optional feature."
}
if (-not (Test-Path $zipPath -PathType Leaf)) {
    throw "Build zip not found: $zipPath. Run 'npm run build' first."
}
if ($IdentityFile -and -not (Test-Path $IdentityFile -PathType Leaf)) {
    throw "SSH identity file not found: $IdentityFile"
}

$target = "$User@$HostName"
$remoteArchive = "/tmp/$pluginName.zip"
$remotePluginDir = "/home/$User/homebrew/plugins/$pluginName"
$sshArgs = @("-p", $Port)
$scpArgs = @("-P", $Port)
if ($IdentityFile) {
    $sshArgs += @("-i", $IdentityFile)
    $scpArgs += @("-i", $IdentityFile)
}

Write-Host "Uploading $zipPath to $target..."
& scp @scpArgs $zipPath "${target}:$remoteArchive"
Assert-LastExitCode "Upload"

$installCommand = "set -eu; sudo rm -rf '$remotePluginDir'; sudo mkdir -p '$remotePluginDir'; sudo bsdtar -xzf '$remoteArchive' -C '$remotePluginDir' --strip-components=1; sudo rm -f '$remoteArchive'; sudo chmod -R u+rwX '$remotePluginDir'"
Write-Host "Replacing $remotePluginDir..."
& ssh -t @sshArgs $target $installCommand
Assert-LastExitCode "Plugin installation"

if (-not $SkipRestart) {
    Write-Host "Restarting Decky Loader (the Deck may ask for your sudo password)..."
    & ssh -t @sshArgs $target "sudo systemctl restart plugin_loader"
    Assert-LastExitCode "Decky Loader restart"
}

Write-Host "Installed $pluginName successfully."