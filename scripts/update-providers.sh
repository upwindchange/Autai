#!/usr/bin/env bash

WARN=0
ERR=0
ok() { echo "  ✓  $*"; }
warn() {
  echo "  ⚠  $*"
  WARN=$((WARN + 1))
}
err() {
  echo "  ✖  $*"
  ERR=$((ERR + 1))
}
section() {
  echo
  echo "── $1 ──"
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  warn "not a git repo; using script-relative root: $ROOT"
fi
SUBMODULE_DIR="$ROOT/reference/models.dev"
PROVIDERS_SRC="$SUBMODULE_DIR/providers"
PROVIDERS_DEST="$ROOT/resources/providers"

echo "Project root : $ROOT"
echo "Source       : $PROVIDERS_SRC"
echo "Destination  : $PROVIDERS_DEST"

section "Update models.dev submodule"
if git -C "$SUBMODULE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$SUBMODULE_DIR" fetch origin 2>/dev/null || warn "git fetch failed (offline?) — continuing"
  cur_branch="$(git -C "$SUBMODULE_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ -n "$cur_branch" ]; then
    if git -C "$SUBMODULE_DIR" pull --ff-only origin "$cur_branch" 2>/dev/null; then
      ok "updated branch '$cur_branch'"
    else
      warn "pull of '$cur_branch' failed — using current checkout"
    fi
  else
    def_branch="$(git -C "$SUBMODULE_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
    def_branch="${def_branch:-main}"
    if git -C "$SUBMODULE_DIR" checkout "$def_branch" 2>/dev/null && git -C "$SUBMODULE_DIR" pull --ff-only 2>/dev/null; then
      ok "updated default branch '$def_branch'"
    else
      short="$(git -C "$SUBMODULE_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
      warn "detached HEAD; could not auto-update — using current checkout ($short)"
    fi
  fi
else
  warn "submodule not initialised at $SUBMODULE_DIR — will copy whatever exists"
fi

if [ ! -d "$PROVIDERS_SRC" ]; then
  err "source directory missing: $PROVIDERS_SRC"
  echo
  echo "Aborting: no provider source to sync. (Run: git submodule update --init)"
  exit 1
fi

section "Purge destination"
if rm -rf "$PROVIDERS_DEST"; then
  ok "removed $PROVIDERS_DEST"
else
  err "failed to remove $PROVIDERS_DEST (continuing)"
fi
if mkdir -p "$PROVIDERS_DEST"; then
  ok "created $PROVIDERS_DEST"
else
  err "failed to create $PROVIDERS_DEST (continuing)"
fi

section "Copy providers"
if cp -a "$PROVIDERS_SRC/." "$PROVIDERS_DEST/" 2>/dev/null; then
  ok "copied tree"
else
  err "cp reported errors — continuing with whatever was copied"
fi

section "Resolve symlinks -> real files"
SYMLINKS=()
while IFS= read -r -d '' link; do
  SYMLINKS+=("$link")
done < <(find "$PROVIDERS_DEST" -type l -print0)

hardlinked=0
broken_removed=0
resolve_fail=0
for link in "${SYMLINKS[@]}"; do
  target="$(readlink -f "$link" 2>/dev/null || true)"
  if [ -z "$target" ] || [ ! -f "$target" ]; then
    warn "broken symlink removed: ${link#"$PROVIDERS_DEST/"}"
    rm -f "$link"
    broken_removed=$((broken_removed + 1))
    continue
  fi
  if rm -f "$link" && ln "$target" "$link" 2>/dev/null; then
    hardlinked=$((hardlinked + 1))
  elif cp "$target" "$link" 2>/dev/null; then
    hardlinked=$((hardlinked + 1))
  else
    err "could not resolve symlink: ${link#"$PROVIDERS_DEST/"}"
    resolve_fail=$((resolve_fail + 1))
  fi
done
echo "    symlinks -> real files : $hardlinked"
echo "    broken symlinks removed: $broken_removed"
[ "$resolve_fail" -gt 0 ] && echo "    unresolved             : $resolve_fail"

section "Rename ':' -> '+' in names"
COLON_PATHS=()
while IFS= read -r -d '' p; do
  COLON_PATHS+=("$p")
done < <(find "$PROVIDERS_DEST" -depth -name '*:*' -print0)

renamed=0
rename_fail=0
for p in "${COLON_PATHS[@]}"; do
  new="${p//:/+}"
  if mv -n "$p" "$new" 2>/dev/null; then
    renamed=$((renamed + 1))
  else
    err "rename failed: ${p#"$PROVIDERS_DEST/"}"
    rename_fail=$((rename_fail + 1))
  fi
done
echo "    paths renamed : $renamed"
[ "$rename_fail" -gt 0 ] && echo "    rename failures: $rename_fail"

section "Verification"

sym_left="$(find "$PROVIDERS_DEST" -type l 2>/dev/null | wc -l)"
broken_left="$(find -L "$PROVIDERS_DEST" -type l 2>/dev/null | wc -l)"
colon_left="$(find "$PROVIDERS_DEST" -name '*:*' 2>/dev/null | wc -l)"
plus_now="$(find "$PROVIDERS_DEST" -name '*+*' 2>/dev/null | wc -l)"
total_files="$(find "$PROVIDERS_DEST" -type f 2>/dev/null | wc -l)"
total_dirs="$(find "$PROVIDERS_DEST" -type d 2>/dev/null | wc -l)"

echo "  symlinks remaining        : $sym_left   (want 0)"
echo "  broken symlinks remaining : $broken_left (want 0)"
echo "  names still containing ':' : $colon_left  (want 0)"
echo "  names containing '+' now   : $plus_now"
echo "  regular files             : $total_files"
echo "  directories               : $total_dirs"
echo "  warnings during run       : $WARN"
echo "  errors during run         : $ERR"

spot="$PROVIDERS_DEST/azure-cognitive-services/models/codex-mini.toml"
if [ -f "$spot" ] && [ ! -L "$spot" ] && [ -s "$spot" ]; then
  ok "spot-check real file: ${spot#"$PROVIDERS_DEST/"} ($(wc -c < "$spot") bytes)"
else
  err "spot-check failed: $spot is not a populated regular file"
fi

echo
if [ "$sym_left" -eq 0 ] && [ "$broken_left" -eq 0 ] && [ "$colon_left" -eq 0 ] && [ "$ERR" -eq 0 ]; then
  echo "✅ RESULT: PASS — providers synced; no symlinks; no ':' in names."
  exit 0
else
  echo "❌ RESULT: FAIL — see the counts above."
  exit 1
fi
