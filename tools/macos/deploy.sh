#!/bin/zsh
#
# Install the versioned launcher into the Desktop app bundle.
#
# The bundle on the Desktop is a copy, not a symlink, so a fix committed here
# does nothing until it is deployed. That gap is not hypothetical: the
# respawn-into-a-FirstMate fix sat in this repo for two days while the Desktop
# copy kept killing panes (2026-07-29). Run `--check` to see the drift, no
# arguments to close it.
#
#   tools/macos/deploy.sh            # install, backing up the current copy
#   tools/macos/deploy.sh --check    # report drift only; exit 1 when stale
#
# Override the target with PANDAMATE_APP=/path/to/Some.app.

set -eu

readonly REPO_ROOT="${0:A:h:h:h}"
readonly SOURCE="$REPO_ROOT/tools/macos/Pandamate Launcher.app/Contents/MacOS/pandamate-launcher"
readonly APP="${PANDAMATE_APP:-$HOME/Desktop/Pandamate.app}"
readonly TARGET="$APP/Contents/MacOS/pandamate-launcher"

if [[ ! -f "$SOURCE" ]]; then
  print -ru2 -- "no launcher in this checkout: $SOURCE"
  exit 1
fi

if [[ ! -d "$APP" ]]; then
  print -ru2 -- "no app bundle at $APP (set PANDAMATE_APP to override)"
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  if [[ ! -f "$TARGET" ]]; then
    print -r -- "STALE: $APP has no launcher yet"
    exit 1
  fi
  if diff -q "$SOURCE" "$TARGET" >/dev/null; then
    print -r -- "up to date: $APP matches this checkout"
    exit 0
  fi
  print -r -- "STALE: $APP differs from this checkout"
  diff -u "$TARGET" "$SOURCE" || true
  exit 1
fi

# Keep the copy being replaced; the launcher is the one thing that must not
# break, and rolling back should not need this repo.
if [[ -f "$TARGET" ]]; then
  cp -p "$TARGET" "$TARGET.bak"
fi

cp "$SOURCE" "$TARGET"
chmod +x "$TARGET"
/bin/zsh -n "$TARGET"
diff -q "$SOURCE" "$TARGET" >/dev/null

print -r -- "deployed to $APP (previous copy at $TARGET.bak)"
