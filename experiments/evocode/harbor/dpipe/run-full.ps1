# One fresh, frozen 15-round run. Never resumes or overwrites an earlier run.
param(
    [string]$Model = 'openai/gpt-5.6-sol'
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
$harbor = 'D:\huawei\harbor_multiturn\.venv\Scripts\harbor.exe'
$priorPythonPath = $env:PYTHONPATH
$priorUtf8 = $env:PYTHONUTF8
$priorEncoding = $env:PYTHONIOENCODING

Push-Location $project
try {
    if (-not (Test-Path -LiteralPath $harbor)) { throw "Harbor missing: $harbor" }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop before running this script.' }

    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $prefix = if ($Model -like 'deepseek/*') {
        'intent-deepseek-dpipe-full-'
    } elseif ($Model -like '*luna*') {
        'intent-luna-dpipe-full-'
    } else {
        'intent-sol-dpipe-full-'
    }
    $runId = $prefix + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $runDir = "D:\huawei\EvoCodeBench\harbor_runs\$runId"
    $dataDir = "D:\huawei\EvoCodeBench\harbor_intent_data\$runId"
    $resultDir = "D:\huawei\EvoCodeBench\harbor_results\$runId"
    foreach ($path in @($runDir, $dataDir, $resultDir)) {
        if (Test-Path -LiteralPath $path) { throw "Refusing existing directory: $path" }
    }

    Write-Host "Preparing fresh run: $runId (model $Model)"
    & python (Join-Path $PSScriptRoot 'prepare.py') --run-id $runId --model $Model
    if ($LASTEXITCODE -ne 0) { throw 'Preparation failed. Evidence retained; Harbor was not started.' }

    $configPath = Join-Path $runDir 'intent.json'
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($config.job_name -ne $runId -or $config.n_attempts -ne 1 -or
        $config.orchestrator.retry.max_retries -ne 0 -or
        $config.verifier.multiround_start_round -ne 1 -or
        $config.verifier.multiround_max_round -ne 15 -or
        $config.verifier.multiround_resume_source) {
        throw 'Configuration is not a fresh single-attempt 1..15 run.'
    }
    $hashes = Get-Content -LiteralPath "$runDir\provenance\official-task-hashes.json" -Raw | ConvertFrom-Json
    foreach ($entry in $hashes) {
        foreach ($file in @($entry.source, $entry.copied)) {
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
                throw "Task hash mismatch: $file"
            }
        }
    }

    $marker = [IO.File]::Open((Join-Path $runDir 'launch-once.lock'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $marker.Dispose()
    $log = Join-Path $runDir 'harbor-launch.log'
    if (Test-Path -LiteralPath $log) { throw "Refusing existing log: $log" }
    $env:PYTHONPATH = Join-Path $runDir 'host-agent'
    Write-Host "Run: $runDir"
    Write-Host "Results: $resultDir"
    Write-Host 'Running once; progress is also saved to harbor-launch.log.'
    # Windows PowerShell represents redirected native stderr as error records.
    # Keep warnings in the log; use the actual process exit code for failure.
    $ErrorActionPreference = 'Continue'
    try {
        & $harbor run -c $configPath 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath $log -ErrorAction Stop
        $runExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    Write-Host "Harbor exit code: $runExitCode"

    $jobDir = Join-Path $resultDir $runId
    $trials = @(Get-ChildItem -LiteralPath $jobDir -Directory -Filter 'task__*' -ErrorAction SilentlyContinue)
    $trialFailure = $null
    $missingRounds = @()
    if ($trials.Count -eq 1) {
        $trialDir = $trials[0].FullName
        $scores = @(1..15 | ForEach-Object {
            $reward = Join-Path $trialDir "verifier\round_${_}_reward.txt"
            [pscustomobject]@{ Round = $_; Reward = $(if (Test-Path -LiteralPath $reward) {
                (Get-Content -LiteralPath $reward -Raw).Trim()
            } else { 'NO RESULT' }) }
        })
        $scores | Format-Table -AutoSize
        $missingRounds = @($scores | Where-Object { $_.Reward -eq 'NO RESULT' } | ForEach-Object { $_.Round })
        $finalPath = Join-Path $trialDir 'result.json'
        if (Test-Path -LiteralPath $finalPath) {
            $final = Get-Content -LiteralPath $finalPath -Raw | ConvertFrom-Json
            Write-Host 'Official verifier result:'
            $final.verifier_result | ConvertTo-Json -Depth 10
            if ($final.exception_info) {
                $final.exception_info | ConvertTo-Json -Depth 6
                $trialFailure = $final.exception_info.exception_message
            } elseif (-not $final.verifier_result) {
                $trialFailure = 'Official verifier result is missing.'
            }
        } else {
            $trialFailure = 'Trial result.json is missing.'
        }
    } else {
        $trialFailure = "Expected one trial, found $($trials.Count)."
    }
    Write-Host "All evidence retained: $runDir"
    if ($runExitCode -ne 0) { throw "Harbor failed with exit code $runExitCode. No automatic restart." }
    if ($trialFailure) { throw "Trial failed: $trialFailure No automatic restart." }
    if ($missingRounds.Count -gt 0) { throw "Run incomplete; missing official results for rounds: $($missingRounds -join ', '). No automatic restart." }
} finally {
    $env:PYTHONPATH = $priorPythonPath
    $env:PYTHONUTF8 = $priorUtf8
    $env:PYTHONIOENCODING = $priorEncoding
    Pop-Location
}
