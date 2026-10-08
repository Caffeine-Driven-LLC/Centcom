#!/bin/sh
# Makes `centcom` a command: links bin/centcom into a folder on your PATH (default ~/.local/bin). Usage: tools/dev/install-cli.sh [dir] | --uninstall
set -e
root=$(cd "$(dirname "$0")/../.." && pwd)
dest="${1:-$HOME/.local/bin}"
if [ "$1" = "--uninstall" ]; then dest="${2:-$HOME/.local/bin}"; if [ -L "$dest/centcom" ]; then rm "$dest/centcom"; echo "removed $dest/centcom"; fi; exit 0; fi
mkdir -p "$dest"
if [ -e "$dest/centcom" ] && [ ! -L "$dest/centcom" ]; then echo "$dest/centcom already exists and is not a link; not touching it." >&2; exit 1; fi
ln -sf "$root/bin/centcom" "$dest/centcom"
echo "linked $dest/centcom -> $root/bin/centcom"
case ":$PATH:" in *":$dest:"*) echo "Run: centcom   (in any folder)";; *) echo "$dest is not on your PATH. Add: export PATH=\"$dest:\$PATH\"";; esac
