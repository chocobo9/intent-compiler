import { execFileSync } from "node:child_process"

/**
 * Git as the factual base (DESIGN §7): commits, checkpoints and rollback. Meaning travels in commit trailers with
 * ids of the shared vocabulary; code reads the trailers only, never the free text of a message.
 */

export function git(dir: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "exp2-ic", GIT_AUTHOR_EMAIL: "exp2-ic@local", GIT_COMMITTER_NAME: "exp2-ic", GIT_COMMITTER_EMAIL: "exp2-ic@local" } })
}

export function initRepo(dir: string): string {
  git(dir, ["init", "-q", "-b", "main"])
  git(dir, ["config", "core.autocrlf", "false"])
  git(dir, ["commit", "-q", "--allow-empty", "-m", "exp2: empty start", "-m", "IC-Round: 0"])
  return head(dir)
}

export function head(dir: string): string { return git(dir, ["rev-parse", "HEAD"]).trim() }

/** Puts the work tree back exactly at a checkpoint: tracked changes reverted, untracked files removed. */
export function resetTo(dir: string, commit: string): void {
  git(dir, ["reset", "-q", "--hard", commit])
  git(dir, ["clean", "-q", "-fdx"])
}

export type Trailers = Record<string, string[]>

/** Commits everything in the work tree with a free-text subject and IC trailers. */
export function commitStep(dir: string, subject: string, trailers: [string, string][]): string {
  git(dir, ["add", "-A"])
  const body = trailers.map(([k, v]) => `${k}: ${v}`).join("\n")
  git(dir, ["commit", "-q", "--allow-empty", "-F", "-"], `${subject.split("\n")[0] || "step"}\n\n${body}\n`)
  return head(dir)
}

/** The IC trailers of one commit, parsed by git itself. */
export function readTrailers(dir: string, commit: string): Trailers {
  const raw = git(dir, ["log", "-1", "--format=%(trailers:only,unfold)", commit])
  const out: Trailers = {}
  for (const line of raw.split("\n")) {
    const m = /^(IC-[A-Za-z-]+):\s*(.*)$/u.exec(line.trim())
    if (m) (out[m[1]] ??= []).push(m[2])
  }
  return out
}

/** Commits from `since` (exclusive) to HEAD, oldest first. */
export function commitsSince(dir: string, since: string): string[] {
  const out = git(dir, ["rev-list", "--reverse", `${since}..HEAD`]).trim()
  return out ? out.split("\n") : []
}
