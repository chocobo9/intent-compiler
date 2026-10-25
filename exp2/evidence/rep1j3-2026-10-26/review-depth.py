# rep1j3 beside rep1j, one script (the Opus design agent's four questions, 2026-10-26; no model, read only):
#   (1) tokens by role and round: reviewer, formalizer, attribution, checks (uncached input / cache read / output, and
#       uncached + 0.1 x cache read + output);
#   (2) by round: reviews, the reviewer's turns (assistant messages and tool calls of its sessions, from OpenCode's
#       local store opened read-only), program runs, findings reported and sent, repair cycles, and how each review
#       ended (NO ISSUES, an empty list, or findings);
#   (3) reviews voided, attempts beyond the first, review calls with an error, the round's status;
#   (4) official cases still failing at each round's end (cases - passed at the scored commit).
# Usage: python -I review-depth.py <out.md> <run dir> [<run dir> ...]
import json, os, sqlite3, sys

out_path, runs = sys.argv[1], sys.argv[2:]
db = os.path.expanduser("~/.local/share/opencode/opencode-local.db")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
def turns(session):
    msgs = tools = 0
    for (mid, data) in con.execute("select id, data from message where session_id = ?", (session,)):
        if json.loads(data).get("role") != "assistant": continue
        msgs += 1
        tools += sum(1 for (p,) in con.execute("select data from part where message_id = ?", (mid,)) if json.loads(p).get("type") == "tool")
    return msgs, tools
def lines(f): return [json.loads(l) for l in open(f, encoding="utf-8") if l.strip()] if os.path.exists(f) else []
ROLES = ["reviewer", "formalizer", "attribution", "checks"]
md = ["# rep1j3 beside rep1j: tokens by role, review depth, review ends, failing cases", ""]
tok_rows, rev_rows, end_rows = [], [], []
for d in runs:
    name = os.path.basename(d).split("-low-")[1].rsplit("-", 1)[0]
    s = json.load(open(os.path.join(d, "state", "exp2-state.json"), encoding="utf-8"))
    ms = {m["round"]: m for m in lines(os.path.join(d, "checkpoints", "measures.jsonl"))}
    sc = lines(os.path.join(d, "checkpoints", "scores.jsonl"))
    for e in sorted(s["executions"], key=lambda x: x["round"]):
        r = e["round"]; t = ms.get(r, {}).get("tokens", {})
        cells = []
        for role in ROLES:
            x = t.get(role, {})
            cost = x.get("uncached_input", 0) + 0.1 * x.get("cache_read", 0) + x.get("output", 0)
            cells.append(f"{x.get('calls', 0)} / {x.get('uncached_input', 0):,} / {x.get('cache_read', 0):,} / {x.get('output', 0):,} ({round(cost):,})")
        tok_rows.append(f"| {name} | R{r} | " + " | ".join(cells) + " |")
        a = e.get("accept", {}); reviews = a.get("reviews", [])
        calls = [c for c in s.get("review_calls", []) if c["round"] == r]
        msgs = tools = 0
        for c in calls:
            if c.get("session"):
                m_, t_ = turns(c["session"]); msgs += m_; tools += t_
        ends = ", ".join(f"V{r}.{v['n']} on {v['cycle']}: " + ("NO ISSUES" if v.get("no_issues") else ("empty list" if not v.get("reported") else f"{v['reported']} found, {v.get('sent', 0)} sent")) for v in reviews)
        rev_rows.append(f"| {name} | R{r} | {len(reviews)} | {len(calls)} | {msgs} / {tools} | {sum(c.get('program_runs', 0) for c in calls)} | {sum(v.get('reported', 0) for v in reviews)} / {sum(v.get('sent', 0) for v in reviews)} | {max(0, len(e['cycles']) - 1)} | {ends or 'no review'} |")
        voided = a.get("voided", 0); extra = sum(max(0, v.get("attempts", 1) - 1) for v in reviews); errs = sum(1 for c in calls if c.get("error")); invalid = sum(1 for c in calls if not c.get("valid", True))
        fin = [x for x in sc if x["round"] == r and not x.get("kind")]
        failing = fin[-1]["total"] - fin[-1]["passed"] if fin else None
        end_rows.append(f"| {name} | R{r} | {voided} | {extra} | {invalid} | {errs} | {e.get('status')} | {failing} |")
md += ["## (1) Tokens by role: calls / uncached input / cache read / output (uncached + 0.1 × cache read + output)", "", "| run | round | reviewer | formalizer | attribution | checks |", "|---|---|---|---|---|---|", *tok_rows, "",
       "## (2) Review depth", "", "| run | round | reviews | review calls | reviewer turns: messages / tool calls | program runs | findings reported / sent | repair cycles | how each review ended |", "|---|---|---|---|---|---|---|---|---|", *rev_rows, "",
       "## (3) and (4) Reviews voided or cut short; official cases failing at the round's end", "", "| run | round | voided | attempts beyond the first | review calls not valid | review calls with an error | round status | official cases failing at the end |", "|---|---|---|---|---|---|---|---|", *end_rows, ""]
open(out_path, "w", encoding="utf-8").write("\n".join(md) + "\n")
print("\n".join(md))
