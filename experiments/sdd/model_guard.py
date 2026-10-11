"""Frozen model guard. Invoked by a generated native argv wrapper.

Every `opencode run` the workflow starts must use the frozen model and variant;
otherwise the call is refused before OpenCode launches. Nothing else is changed.
"""
import subprocess


def main(native, args, model, variant):
    if args and args[0] == 'run':
        options = args[:args.index('--')] if '--' in args else args
        for flag, expected in [('--model', model), ('--variant', variant)]:
            if options.count(flag) != 1 or options.index(flag) + 1 >= len(options) or options[options.index(flag) + 1] != expected:
                raise SystemExit('MODEL_PROFILE_MISMATCH: refusing before OpenCode launch')
    return subprocess.call([native, *args])
