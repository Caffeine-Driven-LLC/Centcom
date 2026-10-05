#!/usr/bin/env bash
# Mirror the shared, identical parts of this repo into the backend repo checkout.
# usage: tools/plan/sync_backend.sh ../Centcom-backend
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
dest="${1:?path to Centcom-backend checkout}"
mkdir -p "$dest"
for d in contracts plan tools/plan; do
  rm -rf "$dest/$d"
  mkdir -p "$(dirname "$dest/$d")"
  cp -a "$here/$d" "$dest/$d"
  find "$dest/$d" -name '__pycache__' -type d -prune -exec rm -rf {} +
done
rm -rf "$dest/tools/plan/templates"
cp "$here/tools/plan/templates/backend-README.md" "$dest/README.md"
cp "$here/.gitignore" "$dest/.gitignore"
# the backend repo is private and has no mascot crowds: drop the client-only ignore lines
sed -i '/mascot/d;/large generated/d' "$dest/.gitignore"
python3 "$here/tools/plan/lock.py" --compare "$dest/contracts"
echo "synced to $dest"
