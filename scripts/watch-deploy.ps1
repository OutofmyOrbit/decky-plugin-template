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
$bundlePath = Join-Path $distDir "index.js"
$mainPy = Join-Path $rootDir "main.py"
$pyModulesDir = Join-Path $rootDir "py_modules"
$remotePluginDir = "/home/$User/homebrew/plugins/$pluginName"
$remoteStageRoot = "/tmp/$($pluginName -replace '[^A-Za-z0-9_.-]', '-')-dist-upload"
$remoteBackendStage = "/tmp/$($pluginName -replace '[^A-Za-z0-9_.-]', '-')-backend-upload"

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
    $uploaded = $false
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        if (Test-Path $bundlePath -PathType Leaf) {
            & ssh @sshArgs $target "rm -rf '$remoteStageRoot'"
            if ($LASTEXITCODE -eq 0) {
                & scp @scpArgs $bundlePath "$target`:$remoteStageRoot"
                if ($LASTEXITCODE -eq 0) {
                    $uploaded = $true
                    break
                }
            }
        }
        Start-Sleep -Milliseconds 300
    }
    if (-not $uploaded) {
        throw "Frontend upload did not complete after waiting for $bundlePath."
    }

    $installCommand = "set -eu; mkdir -p '$remotePluginDir/dist'; mv '$remoteStageRoot' '$remotePluginDir/dist/index.js'"
    Invoke-SudoCommand $installCommand
    Write-Host "Frontend deployed."
}

function Deploy-Backend {
    Write-Host "Deploying Python changes..."
    & ssh @sshArgs $target "rm -rf '$remoteBackendStage'; mkdir -p '$remoteBackendStage'"
    Assert-LastExitCode "Backend staging cleanup"
    $backendSources = @($mainPy, $pyModulesDir)
    & scp @scpArgs -r @backendSources "$target`:$remoteBackendStage"
    Assert-LastExitCode "Backend upload"

    $installCommand = "set -eu; rm -rf '$remotePluginDir/py_modules'; mv '$remoteBackendStage/py_modules' '$remotePluginDir/py_modules'; mv '$remoteBackendStage/main.py' '$remotePluginDir/main.py'; rm -rf '$remoteBackendStage'"
    Invoke-SudoCommand $installCommand
    Write-Host "Python changes deployed."
}

$watchProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "watch" -WorkingDirectory $rootDir -NoNewWindow -PassThru
try {
    Write-Host "Rollup watch started (PID $($watchProcess.Id))."
    Write-Host "Watching $distDir, $mainPy, and $pyModulesDir. Press Ctrl+C to stop."

    $lastDistChange = [DateTime]::MinValue
    $lastBackendChange = [DateTime]::MinValue
    $lastDistDeployment = [DateTime]::MinValue
    $lastBackendDeployment = [DateTime]::MinValue
    while (-not $watchProcess.HasExited) {
        $restartRequired = $false
        if (Test-Path $bundlePath -PathType Leaf) {
            $latestChange = (Get-ChildItem $distDir -File -Recurse | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
            if ($latestChange -gt $lastDistChange) {
                $lastDistChange = $latestChange
            }
            if ($lastDistChange -gt $lastDistDeployment -and ((Get-Date).ToUniversalTime() - $lastDistChange).TotalMilliseconds -ge 300) {
                Deploy-Dist
                $lastDistDeployment = $lastDistChange
                $restartRequired = $true
            }
        }
        $backendFiles = @()
        if (Test-Path $mainPy) {
            $backendFiles += Get-Item $mainPy
        }
        if (Test-Path $pyModulesDir) {
            $backendFiles += Get-ChildItem $pyModulesDir -File -Recurse
        }
        if ($backendFiles.Count -gt 0) {
            $latestBackendChange = ($backendFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
            if ($latestBackendChange -gt $lastBackendChange) {
                $lastBackendChange = $latestBackendChange
            }
            if ($lastBackendChange -gt $lastBackendDeployment -and ((Get-Date).ToUniversalTime() - $lastBackendChange).TotalMilliseconds -ge 300) {
                Deploy-Backend
                $lastBackendDeployment = $lastBackendChange
                $restartRequired = $true
            }
        }
        if ($restartRequired -and -not $SkipRestart) {
            Write-Host "Restarting Decky Loader..."
            Invoke-SudoCommand "systemctl restart plugin_loader"
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
