"""Copy a pinned OpenCode host to a NEW path and add opt-in stream diagnostics."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

PROCESSOR = Path("packages/opencode/src/session/processor.ts")
MODULE = Path("packages/opencode/src/session/management-stream-observer.ts")
RUN = Path("packages/opencode/src/cli/cmd/run.ts")


def patch_run(text: str) -> str:
    before = '''            const error = await completed
            if (error) process.exitCode = 1
'''
    after = before + '''          }
          async function executionHooks() {
            if (args.attach) return []
            // Intent Compiler: finish management before instance teardown/process.exit.
            const { AppRuntime } = await import("@/effect/app-runtime")
            const { Plugin } = await import("@/plugin")
            const InstanceStore = await import("@/project/instance-store")
            const hooks = await AppRuntime.runPromise(
              InstanceStore.Service.use((store) => store.provide(
                { directory: cwd },
                Plugin.Service.use((plugin) => plugin.list()),
              )),
            )
            if (process.env.EXPERIMENT_ARM_MODE === "compiler" &&
                !hooks.some((hook) => typeof (hook as any)["experimental.execution.drain"] === "function")) {
              throw new Error(`Intent Compiler execution drain missing for directory ${cwd}`)
            }
            return hooks
          }
          async function drainExecution() {
            const hooks = await executionHooks()
            for (const hook of hooks) {
              const drain = (hook as any)["experimental.execution.drain"]
              if (!drain) continue
              await drain({ sessionID })
            }
'''
    if text.count(before) != 1:
        raise ValueError("Pinned CLI finish anchor must occur once")
    text = text.replace(before, after)
    start = "          if (args.command) {\n            const result = await client.session.command({"
    end = "          await finish()\n          return\n        }\n\n        const model = pick(args.model)"
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError("Pinned CLI noninteractive request anchors must occur once")
    text = text.replace(start, "          try {\n            await executionHooks()\n" + start)
    return text.replace(end, "          await finish()\n          return\n          } finally {\n            await drainExecution()\n          }\n        }\n\n        const model = pick(args.model)")


def patch_processor(text: str) -> str:
    changes = [
        ('const DOOM_LOOP_THRESHOLD = 3', 'import { env } from "node:process"\nimport { createManagementStreamObserver } from "./management-stream-observer"\n\nconst DOOM_LOOP_THRESHOLD = 3'),
        ('            const stream = llm.stream(streamInput)\n', '''            const observation = createManagementStreamObserver({
              path: env.OPENCODE_MANAGEMENT_STREAM_LOG,
              enabled: "StructuredOutput" in streamInput.tools,
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
            })
            const stream = llm.stream(streamInput)
'''),
        ('              Stream.tap((event) => handleEvent(event)),', '''              Stream.tap((event) => Effect.sync(() => observation.observe(event))),
              Stream.tap((event) => handleEvent(event)),'''),
        ('              Stream.runDrain,\n', '''              Stream.runDrain,
              Effect.onExit((exit) => Effect.sync(() => observation.close(
                Exit.isSuccess(exit) ? "success" : Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "failure",
              ))),
'''),
    ]
    for before, after in changes:
        if text.count(before) != 1:
            raise ValueError(f"Pinned host anchor must occur once: {before!r}")
        text = text.replace(before, after)
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--overlay-only", action="store_true", help="Write only changed files for overlaying onto a separately copied fresh host")
    parser.add_argument("--observer-import", default="./management-stream-observer", help="Observer module import when mounted separately")
    args = parser.parse_args()
    source, target = args.source.resolve(), args.target.resolve()
    if target.exists() or target == source or source in target.parents or target in source.parents:
        raise ValueError("Target must be new and separate from the source host")
    if "intent-compiler-d3w9-r1-gpt6-luna-fast-20260925-001" in [part.casefold() for part in target.parts]:
        raise ValueError("Historical run directories are immutable")
    original_bytes = (source / PROCESSOR).read_bytes()
    original = original_bytes.decode("utf-8").replace("\r\n", "\n")
    patched = patch_processor(original).replace('from "./management-stream-observer"', 'from ' + json.dumps(args.observer_import))
    module = Path(__file__).with_name("management-stream-observer.ts").read_text(encoding="utf-8")
    if args.overlay_only:
        shutil.copytree(source / PROCESSOR.parent, target / PROCESSOR.parent)
        shutil.copytree(source / RUN.parent, target / RUN.parent)
    else:
        shutil.copytree(source, target, ignore=shutil.ignore_patterns(".git"))
    (target / PROCESSOR).write_text(patched, encoding="utf-8", newline="\n")
    (target / MODULE).write_text(module, encoding="utf-8", newline="\n")
    run_original = (source / RUN).read_text(encoding="utf-8")
    run_patched = patch_run(run_original)
    (target / RUN).write_text(run_patched, encoding="utf-8", newline="\n")
    digest = lambda text: hashlib.sha256(text.encode("utf-8")).hexdigest()
    manifest = {"patch": "dpipe-management-stream-v1", "source": str(source), "target": str(target),
                "overlay_only": args.overlay_only, "processor_original_sha256": hashlib.sha256(original_bytes).hexdigest(),
                "processor_patched_sha256": digest(patched), "observer_sha256": digest(module),
                "enable_env": "OPENCODE_MANAGEMENT_STREAM_LOG", "heartbeat_ms": 5000,
                "raw_sample_limit_bytes_per_stream": 4096,
                "run_original_sha256": digest(run_original), "run_patched_sha256": digest(run_patched),
                "changed_files": [PROCESSOR.as_posix(), MODULE.as_posix(), RUN.as_posix()]}
    (target / "management-stream-patch.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
