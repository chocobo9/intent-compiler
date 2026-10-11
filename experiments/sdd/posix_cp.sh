# Sourced through BASH_ENV before the upstream workflow runs; the workflow is unchanged.
# The MSYS runtime behind Git Bash treats NAME and NAME.exe as one file, so
# `cp -r` of a directory holding both (e.g. a Linux build `dpipe` next to a
# Windows build `dpipe.exe`) fails with "File exists". On Linux/macOS, where the
# workflow was written, they are two files. Copy a directory tree to a new
# destination with POSIX file semantics; every other cp call is unchanged.
cp() {
  if [[ $# -eq 3 && "$1" == "-r" && -d "$2" && ! -e "$3" ]]; then
    "${SDD_POSIX_CP_PYTHON:-python3}" -c 'import shutil, sys; shutil.copytree(sys.argv[1], sys.argv[2], symlinks=True)' \
      "$(cygpath -m "$2")" "$(cygpath -m "$3")"
  else
    command cp "$@"
  fi
}
