# Step 2 (no model, read only): the executor's sessions behind the untouched sends (sends.json), from OpenCode's local
# store (~/.local/share/opencode/opencode-local.db, opened read-only). For each send: the user messages of its cycle
# (time after the previous cycle's commit, up to this cycle's commit: the message the item went in, and the untouched
# message when one went), the assistant replies' text, the files its tool calls wrote, and the session's length when the
# cycle began (messages before it, and the context the last reply before it carried: tokens input + cache read). The
# patches its tool calls wrote (apply_patch, edit, write), in the session and in the sessions its task calls opened.
# Usage: python -I export.py <sends.json> <out.json>
import json, os, sqlite3, sys

sends = json.load(open(sys.argv[1], encoding="utf-8"))
db = os.path.expanduser("~/.local/share/opencode/opencode-local.db")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
def patch_of(p):
    i = (p.get("state") or {}).get("input") or {}
    return i.get("patchText") or i.get("newString") or i.get("content") or ""
def load(sid):
    msgs = []
    for mid, t, data in con.execute("select id, time_created, data from message where session_id = ? order by time_created, id", (sid,)):
        d = json.loads(data)
        parts = [json.loads(p) for (p,) in con.execute("select data from part where message_id = ? order by time_created, id", (mid,))]
        text = "\n".join(p.get("text", "") for p in parts if p.get("type") == "text")
        edits = [p for p in parts if p.get("type") == "tool" and p.get("tool") in ("apply_patch", "edit", "write", "patch", "multiedit")]
        files = sorted({f for p in edits for f in ([(p.get("state") or {}).get("input", {}).get("filePath") or ""] + [l.split(": ", 1)[1] for l in patch_of(p).splitlines() if l.startswith("*** Update File: ") or l.startswith("*** Add File: ")])} - {""})
        tools = [p.get("tool") for p in parts if p.get("type") == "tool"]
        tok = d.get("tokens") or {}
        msgs.append({"id": mid, "t": t, "role": d.get("role"), "text": text, "files": files, "patches": [patch_of(p) for p in edits], "tools": tools, "context": (tok.get("input") or 0) + ((tok.get("cache") or {}).get("read") or 0)})
    return msgs
sessions, children = {}, {}
for sid in sorted({s["session"] for s in sends}):
    sessions[sid] = load(sid)
    children[sid] = [m for (cid,) in con.execute("select id from session where parent_id = ?", (sid,)) for m in load(cid)]
out = []
for s in sends:
    msgs = sessions.get(s["session"], [])
    lo, hi = s["window"]
    win = [m for m in msgs if (lo is None or m["t"] > lo) and m["t"] <= hi]
    before = [m for m in msgs if lo is not None and m["t"] <= lo] if lo is not None else [m for m in msgs if win and m["t"] < win[0]["t"]]
    ctx = [m["context"] for m in before if m["role"] == "assistant" and m["context"]]
    out.append({**{k: s[k] for k in ("run", "round", "cycle", "item", "via", "session", "files", "anchors", "text", "answer", "untouched_n", "outcome")},
                "user": [m["text"] for m in win if m["role"] == "user"],
                "reply": "\n\n".join(m["text"] for m in win if m["role"] == "assistant" and m["text"]),
                "tool_files": sorted({f for m in win for f in m["files"]} | {f for m in children.get(s["session"], []) if (lo is None or m["t"] > lo) and m["t"] <= hi for f in m["files"]}),
                "patches": [p for m in win for p in m["patches"]] + [p for m in children.get(s["session"], []) if (lo is None or m["t"] > lo) and m["t"] <= hi for p in m["patches"]],
                "task_calls": sum(m["tools"].count("task") for m in win),
                "tool_calls": sum(len(m["tools"]) for m in win if m["role"] == "assistant"),
                "messages_before": len(before), "context_before": ctx[-1] if ctx else 0,
                "found": bool(win)})
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(out), "sends;", sum(1 for o in out if o["found"]), "with messages in their window;", sum(1 for o in out if o["user"]), "with a user message")
