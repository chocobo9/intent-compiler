param([string]$RunId, [switch]$Once)

# Read-only monitor. Ctrl+C ends this monitor, never the Harbor process.
$ErrorActionPreference = 'Stop'
if (-not $RunId) {
    $latest = Get-ChildItem 'D:\huawei\EvoCodeBench\harbor_runs' -Directory -Filter 'intent-*-dpipe-full-*' |
        Sort-Object CreationTime -Descending | Select-Object -First 1
    if (-not $latest) { throw 'No standalone full run found.' }
    $RunId = $latest.Name
}
$run = "D:\huawei\EvoCodeBench\harbor_runs\$RunId"
$data = "D:\huawei\EvoCodeBench\harbor_intent_data\$RunId"
$job = "D:\huawei\EvoCodeBench\harbor_results\$RunId\$RunId"
if (-not (Test-Path -LiteralPath $run)) { throw "Run not found: $run" }
$started = (Get-Item -LiteralPath $run).CreationTime

function Read-JsonFile([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) } catch { return $null }
    }
}

do {
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add("READ-ONLY MONITOR | $(Get-Date -Format 'HH:mm:ss') | refresh 10s")
    $lines.Add($RunId)
    $lines.Add("Elapsed: $(([datetime]::Now - $started).ToString('hh\:mm\:ss')) | Ctrl+C closes only this monitor")
    $lines.Add('')
    $tail = @(Get-Content -LiteralPath "$run\harbor-launch.log" -Tail 100 -ErrorAction SilentlyContinue)
    $roundLine = $tail | Where-Object { $_ -match '=== Round \d+/15' } | Select-Object -Last 1
    $lines.Add("Round: $(if ($roundLine) { $roundLine.Trim() } else { 'Preparing / waiting for progress log' })")

    $snapshot = Read-JsonFile "$data\compiler-store\v2-runs\$RunId\snapshot.json"
    if ($snapshot) {
        $calls = @($snapshot.management_calls)
        $lines.Add("Completed management calls: $($calls.Count) | Executions started: $(@($snapshot.executions).Count) | Returns recorded: $(@($snapshot.execution_outcomes).Count)")
        if ($calls.Count) {
            $last = $calls[-1]
            $lines.Add("Last completed call: $($last.call_id) $($last.generation_stage) $($last.kind) $($last.status), $([math]::Round($last.duration_ms / 1000, 1))s")
        }
        $lines.Add("Denied operations: $(@($snapshot.denied_calls).Count) | Total request budget used: $($snapshot.budget.total_management_requests)/$($snapshot.budget.max_total_management_requests)")
    }
    $stream = $null
    try {
        $raw = Get-Content -LiteralPath "$data\audit\management-stream.jsonl" -Tail 1 -ErrorAction Stop
        if ($raw) { $stream = $raw | ConvertFrom-Json }
    } catch {}
    if ($stream) {
        $age = [math]::Max(0, [math]::Round(([datetimeoffset]::UtcNow - [datetimeoffset]::Parse($stream.at)).TotalSeconds))
        if ($stream.kind -eq 'stream-close') {
            $lines.Add("Last management stream ended: $($stream.outcome), $([math]::Round($stream.elapsed_ms / 1000, 1))s; $($age)s ago")
        } else {
            $lines.Add("Management stream: $([math]::Round($stream.elapsed_ms / 1000, 1))s at last update; update age $($age)s")
            $lines.Add("Received parameter bytes: $($stream.parameter_bytes) | Deadline: 300s per request")
        }
    }

    $trials = @(Get-ChildItem -LiteralPath $job -Directory -Filter 'task__*' -ErrorAction SilentlyContinue)
    if ($trials.Count -eq 1) {
        $trial = $trials[0]
        $scores = @()
        foreach ($i in 1..15) {
            $p = Join-Path $trial.FullName "verifier\round_${i}_reward.txt"
            if (Test-Path -LiteralPath $p) { $scores += "R${i}=$((Get-Content -LiteralPath $p -Raw).Trim())" }
        }
        $lines.Add("Official scores ($($scores.Count)/15): $(if ($scores.Count) { $scores -join '  ' } else { 'none yet' })")
        $result = Read-JsonFile (Join-Path $trial.FullName 'result.json')
        if ($result) {
            $lines.Add("Final verifier result: $($result.verifier_result | ConvertTo-Json -Compress -Depth 8)")
            if ($result.exception_info) { $lines.Add("Exception: $($result.exception_info.exception_message)") }
        }
        $container = $trial.Name.ToLowerInvariant() + '-main-1'
        $state = & docker ps --filter "name=^/$container`$" --format '{{.Status}}' 2>$null
        $lines.Add("Container: $(if ($state) { $state } else { 'not running (may be saving a round snapshot or finished)' })")
        if ($state) {
            # Read the end of the executor log without loading model prompts or tool arguments.
            $probe = 'import json,pathlib; p=pathlib.Path("/logs/agent/opencode.txt"); f=p.open("rb") if p.exists() else None; size=p.stat().st_size if f else 0; f.seek(max(0,size-262144)) if f else None; rows=f.read().decode("utf-8",errors="replace").splitlines() if f else []; events=[]; exec("for line in rows:\n try: events.append(json.loads(line))\n except (ValueError,TypeError): pass"); e=events[-1] if events else {}; part=e.get("part",{}); print(json.dumps({"event":e.get("type"),"tool":part.get("tool"),"status":part.get("state",{}).get("status"),"timestamp":e.get("timestamp")}))'
            try {
                $encodedProbe = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probe))
                $rawEvent = & docker exec $container python3 -c "import base64;exec(base64.b64decode('$encodedProbe'))" 2>$null
                if ($LASTEXITCODE -eq 0 -and $rawEvent) {
                    $event = $rawEvent | ConvertFrom-Json
                    if ($event.event) {
                        $eventTime = [datetimeoffset]::FromUnixTimeMilliseconds([long]$event.timestamp)
                        $lines.Add("Last executor event: $($eventTime.ToLocalTime().ToString('HH:mm:ss')) $($event.event) $($event.tool) $($event.status)")
                    }
                }
            } catch {}
        }
    }
    $lines.Add('')
    $lines.Add('No reliable ETA yet. Missing scores are NOT zero. A quiet executor log does not prove a stall.')
    $lines.Add("Log: $run\harbor-launch.log")
    if (-not $Once) { Clear-Host }
    $lines | ForEach-Object { Write-Host $_ }
    if (-not $Once) { Start-Sleep -Seconds 10 }
} while (-not $Once)
