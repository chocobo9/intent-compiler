# Read-only summary of one dpipe run: per-round results plus every management batch
# outcome, so the full set of problems can be read at once.
param([string]$RunId)

$ErrorActionPreference = 'Stop'
if (-not $RunId) {
    $RunId = (Get-ChildItem 'D:\huawei\EvoCodeBench\harbor_runs' -Directory -Filter 'intent-*-dpipe-full-*' |
        Sort-Object CreationTime -Descending | Select-Object -First 1).Name
}
$run = "D:\huawei\EvoCodeBench\harbor_runs\$RunId"
$data = "D:\huawei\EvoCodeBench\harbor_intent_data\$RunId"
$results = "D:\huawei\EvoCodeBench\harbor_results\$RunId"
Write-Output "run: $RunId"

$trial = Get-ChildItem -LiteralPath $results -Directory -Recurse -Depth 2 -Filter 'task__*' -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Output ''
Write-Output '=== rounds ==='
if ($trial) {
    foreach ($n in 1..15) {
        $rewardPath = Join-Path $trial.FullName "verifier\round_${n}_reward.txt"
        $reward = if (Test-Path -LiteralPath $rewardPath) { (Get-Content -LiteralPath $rewardPath -Raw).Trim() } else { 'NO RESULT' }
        $auditDir = Join-Path $data ("audit\round-{0:D2}" -f $n)
        $audit = if (Test-Path -LiteralPath $auditDir) { 'evidence' } else { '-' }
        $state = if (Test-Path -LiteralPath (Join-Path $trial.FullName "round_${n}\state")) { 'state' } else { '' }
        Write-Output ("Round {0,2}: reward={1,-9} audit={2} {3}" -f $n, $reward, $audit, $state)
    }
} else {
    Write-Output 'no trial directory yet'
}

Write-Output ''
Write-Output '=== management batches ==='
$snapshotPath = Join-Path $data "compiler-store\v2-runs\$RunId\snapshot.json"
if (Test-Path -LiteralPath $snapshotPath) {
    $snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
    $calls = @($snapshot.management_calls)
    Write-Output ("completed calls={0}  budget={1}/{2}  dispatches={3}  executions={4}  returns={5}  assessments={6}  questions={7}" -f `
        $calls.Count, $snapshot.budget.total_management_requests, $snapshot.budget.max_total_management_requests, `
        @($snapshot.dispatches).Count, @($snapshot.executions).Count, @($snapshot.execution_outcomes).Count, `
        @($snapshot.assessments).Count, @($snapshot.questions).Count)
    foreach ($record in $snapshot.management_log) {
        $stages = ($record.attempts | ForEach-Object { if ($_.generation_stage) { $_.generation_stage } else { $_.kind } }) -join '/'
        $trigger = ($record.trigger_event_ids | ForEach-Object { ($_ -split ':')[0..1] -join ':' }) -join ','
        $message = [string]$record.error_message
        $message = ($message -replace '\s+', ' ')
        if ($message.Length -gt 150) { $message = $message.Substring(0, 150) }
        $errorCode = if ($record.error_code) { $record.error_code } else { '-' }
        # def = events this failed batch set aside; unclassified = passages of the
        # batch's own text that no selection and no entry named (code default).
        $deferred = if ($record.deferred_event_ids) { @($record.deferred_event_ids).Count } else { 0 }
        $unclassified = if ($record.source_defaults) { $record.source_defaults.count } else { 0 }
        Write-Output ("seq={0,-3} {1,-18} {2,-20} calls={3} stages={4} trigger={5} def={6} unclassified={7} {8}" -f `
            $record.sequence, $record.status, $errorCode, $record.attempts.Count, $stages, `
            $trigger.Split(':')[-1], $deferred, $unclassified, $message)
    }
    $byStatus = $snapshot.management_log | Group-Object status | ForEach-Object { "$($_.Name)=$($_.Count)" }
    Write-Output ("batch outcomes: " + ($byStatus -join '  '))
} else {
    Write-Output 'no snapshot yet'
}

Write-Output ''
Write-Output '=== round-gate notes from the launch log ==='
$gate = Select-String -LiteralPath (Join-Path $run 'harbor-launch.log') -Pattern 'ROUND-GATE' -ErrorAction SilentlyContinue
if ($gate) { $gate | ForEach-Object { $_.Line.Trim() } } else { Write-Output '(none)' }
