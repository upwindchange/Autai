#!/bin/bash
# Sync provider data from the models.dev submodule to resources/providers.
# Handles Windows compatibility:
#   - Replaces symlinks with hard links (real files for git/Windows)
#   - Renames ':' to '+' in filenames
#
# Usage: bash scripts/update-providers.sh

set -euo pipefail

# ── Locate project root ──────────────────────────────────────────────
ROOT="$(git rev-parse --show-toplevel)"
SUBMODULE_DIR="$ROOT/reference/models.dev"
PROVIDERS_SRC="$SUBMODULE_DIR/providers"
PROVIDERS_DEST="$ROOT/resources/providers"

echo "==> Project root: $ROOT"

# ── Update the models.dev submodule ──────────────────────────────────
echo "==> Updating models.dev submodule..."
cd "$SUBMODULE_DIR"
branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||')
git checkout "${branch:-main}"
git pull
cd "$ROOT"

# ── Purge and recreate destination ───────────────────────────────────
echo "==> Purging $PROVIDERS_DEST..."
rm -rf "$PROVIDERS_DEST"
mkdir -p "$PROVIDERS_DEST"

# ── Copy data (preserves symlinks for the next step) ─────────────────
echo "==> Copying providers..."
cp -a "$PROVIDERS_SRC/." "$PROVIDERS_DEST/"

# ── Replace symlinks with hard links ─────────────────────────────────
# Must happen BEFORE the ':' rename — some symlinks point to ':' files.
echo "==> Replacing symlinks with hard links..."
symlink_count=0
while IFS= read -r -d '' link; do
  target="$(readlink -f "$link")"
  if [ ! -f "$target" ]; then
    echo "  WARNING: broken symlink: $link -> $target"
    rm -f "$link"
    continue
  fi
  rm -f "$link"
  ln "$target" "$link"
  symlink_count=$((symlink_count + 1))
done < <(find "$PROVIDERS_DEST" -type l -print0)
echo "    Replaced $symlink_count symlinks"

# ── Rename ':' to '+' in filenames (Windows compat) ──────────────────
echo "==> Renaming ':' to '+' in filenames..."
rename_count=0
while IFS= read -r -d '' file; do
  new_name="${file//:/+}"
  mv "$file" "$new_name"
  rename_count=$((rename_count + 1))
done < <(find "$PROVIDERS_DEST" -name '*:*' -print0)
echo "    Renamed $rename_count files"

echo "==> Done!"
