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
$distDir = Join-Path $rootDir "dist"
$remotePluginDir = "/home/$User/homebrew/plugins/$pluginName"
$remoteStageRoot = "/tmp/$($pluginName -replace '[^A-Za-z0-9_.-]', '-')-dist-upload"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue) -or -not (Get-Command scp -ErrorAction SilentlyContinue)) {
    throw "OpenSSH client tools (ssh and scp) are required."
}
if ($IdentityFile -and -not (Test-Path $IdentityFile -PathType Leaf)) {
    throw "SSH identity file not found: $IdentityFile"
}

$target = "$User@$HostName"
$sshArgs = @("-p", $Port)
$scpArgs = @("-P", $Port)
if ($IdentityFile) {
    $sshArgs += @("-i", $IdentityFile)
    $scpArgs += @("-i", $IdentityFile)
}

$sudoPassword = Read-Host "Enter the sudo password for $target" -AsSecureString
$passwordHandle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sudoPassword)
try {
    $sudoPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordHandle)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordHandle)
}

function Invoke-SudoCommand {
    param([string]$Command)

    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Command))
    $remoteCommand = "sudo -S -p '' sh -c 'echo $encodedCommand | base64 -d | sh'"
    "$sudoPasswordText`n" | & ssh @sshArgs $target $remoteCommand
    Assert-LastExitCode "Remote sudo command"
}

function Deploy-Dist {
    Write-Host "Deploying frontend changes..."
    & ssh @sshArgs $target "rm -rf '$remoteStageRoot'"
    Assert-LastExitCode "Frontend staging cleanup"
    & scp @scpArgs -r $distDir "$target`:$remoteStageRoot"
    Assert-LastExitCode "Frontend upload"

    $installCommand = "set -eu; rm -rf '$remotePluginDir/dist'; mv '$remoteStageRoot' '$remotePluginDir/dist'"
    Invoke-SudoCommand $installCommand

    if (-not $SkipRestart) {
        Invoke-SudoCommand "systemctl restart plugin_loader"
    }
    Write-Host "Frontend deployed."
}

$watchProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "watch" -WorkingDirectory $rootDir -NoNewWindow -PassThru
try {
    Write-Host "Rollup watch started (PID $($watchProcess.Id))."
    Write-Host "Watching $distDir. Press Ctrl+C to stop."

    $lastChange = [DateTime]::MinValue
    $lastDeployment = [DateTime]::MinValue
    while (-not $watchProcess.HasExited) {
        if (Test-Path $distDir) {
            $latestChange = (Get-ChildItem $distDir -File -Recurse | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
            if ($latestChange -gt $lastChange) {
                $lastChange = $latestChange
            }
            if ($lastChange -gt $lastDeployment -and ((Get-Date).ToUniversalTime() - $lastChange).TotalMilliseconds -ge 300) {
                Deploy-Dist
                $lastDeployment = $lastChange
            }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($watchProcess.ExitCode -ne 0) {
        throw "Rollup watch exited with code $($watchProcess.ExitCode)."
    }
}
finally {
    if (-not $watchProcess.HasExited) {
        Stop-Process -Id $watchProcess.Id -Force
    }
}
