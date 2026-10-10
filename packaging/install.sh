#!/bin/sh
# Centcom installer. Downloads a release, proves it is the published one, and only then puts it in place.
#   install.sh [--version X.Y.Z] [--base-url URL] [--dir DIR] [--target OS-ARCH] [--pubkey-file FILE] [--modify-path]
# It checks BOTH the SHA-256 against SHA256SUMS AND the Ed25519 signature of the digest (the scheme of tools/release/sign.mjs) before it
# moves or runs anything. Any failure stops it with nothing installed and the temporary files removed. No sudo; it never edits shell
# startup files unless you pass --modify-path. Needs: sh, curl, tar, openssl (3.x), and sha256sum or shasum.
set -eu

# The release signing key goes here when the signing procedure exists (docs/packaging-notes.md). Until then the installer refuses to install.
PUBKEY_PEM=''
BASE_URL="${CENTCOM_BASE_URL:-https://downloads.centcom.invalid/releases}"
VERSION=''; DIR="${HOME:-.}/.local/bin"; TARGET=''; PUBFILE=''; MODIFY_PATH=0
SUPPORTED='linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64'

die() { printf 'centcom install: %s\n' "$1" >&2; exit "${2:-1}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || die 'missing value for --version' 2; VERSION="$2"; shift 2 ;;
    --base-url) [ $# -ge 2 ] || die 'missing value for --base-url' 2; BASE_URL="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || die 'missing value for --dir' 2; DIR="$2"; shift 2 ;;
    --target) [ $# -ge 2 ] || die 'missing value for --target' 2; TARGET="$2"; shift 2 ;;
    --pubkey-file) [ $# -ge 2 ] || die 'missing value for --pubkey-file' 2; PUBFILE="$2"; shift 2 ;;
    --modify-path) MODIFY_PATH=1; shift ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" 2 ;;
  esac
done

# --- what to install, for which computer
if [ -z "$TARGET" ]; then
  case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) os=unknown ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) arch=unknown ;; esac
  TARGET="$os-$arch"
fi
case " $SUPPORTED " in *" $TARGET "*) ;; *) die "this computer ($TARGET) is not supported. Supported: $SUPPORTED" 1 ;; esac
[ -n "$VERSION" ] || die 'give the version to install: --version X.Y.Z' 2
case "$VERSION" in *[!0-9A-Za-z.-]*|'') die 'that version does not look right' 2 ;; esac

# --- the key: nothing is installed without one
TMP=$(mktemp -d "${TMPDIR:-/tmp}/centcom-install.XXXXXX") || die 'cannot make a temporary folder'
trap 'rm -rf "$TMP"' EXIT INT TERM HUP
if [ -n "$PUBFILE" ]; then [ -r "$PUBFILE" ] || die 'cannot read the public key file'; cp "$PUBFILE" "$TMP/pub.pem"
elif [ -n "$PUBKEY_PEM" ]; then printf '%s\n' "$PUBKEY_PEM" > "$TMP/pub.pem"
else die 'no release signing key is built into this installer yet, so nothing was installed.'; fi
command -v openssl >/dev/null 2>&1 || die 'openssl is needed to check the signature, so nothing was installed.'
if command -v sha256sum >/dev/null 2>&1; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die 'sha256sum or shasum is needed to check the download, so nothing was installed.'; fi

# --- download, with three tries (waits of 1, 3 and 9 seconds)
fetch() { # url dest
  n=0; for wait in ${CENTCOM_INSTALL_WAITS:-1 3 9}; do
    if curl -fsSL --proto '=https,file' --max-time 300 -o "$2" "$1" 2>/dev/null; then return 0; fi
    n=$((n + 1)); [ "$n" -lt 3 ] && sleep "$wait"
  done; return 1
}
case "$TARGET" in win32-*) EXT=zip ;; *) EXT=tar.gz ;; esac
ARCHIVE="centcom-$VERSION-$TARGET.$EXT"
fetch "$BASE_URL/$ARCHIVE" "$TMP/$ARCHIVE" || die 'could not download the release, so nothing was installed.'
fetch "$BASE_URL/SHA256SUMS" "$TMP/SHA256SUMS" || die 'could not download SHA256SUMS, so nothing was installed.'
fetch "$BASE_URL/$ARCHIVE.sig" "$TMP/$ARCHIVE.sig" || die 'could not download the signature, so nothing was installed.'

# --- prove it: the checksum, then the signature over the 32 raw digest bytes (base64url, as tools/release/sign.mjs writes it)
want=$(awk -v f="$ARCHIVE" '$2 == f || $2 == "*" f { print $1 }' "$TMP/SHA256SUMS" | head -n 1)
[ -n "$want" ] || die 'SHA256SUMS does not list this download, so nothing was installed.'
have=$(sha256 "$TMP/$ARCHIVE")
[ "$want" = "$have" ] || die 'the download is not the one that was published (its checksum differs), so nothing was installed.'
esc=$(printf '%s' "$have" | awk '{ h = "0123456789abcdef"; for (i = 1; i < length($0); i += 2) printf "\\%03o", (index(h, substr($0, i, 1)) - 1) * 16 + index(h, substr($0, i + 1, 1)) - 1 }')
printf "$esc" > "$TMP/digest.bin" 2>/dev/null || die 'could not read the digest, so nothing was installed.'
[ "$(wc -c < "$TMP/digest.bin" | tr -d ' ')" = 32 ] || die 'could not read the digest, so nothing was installed.'
tr '_-' '/+' < "$TMP/$ARCHIVE.sig" | tr -d '\n\r ' > "$TMP/sig.b64"
case $(( $(wc -c < "$TMP/sig.b64") % 4 )) in 2) printf '==' >> "$TMP/sig.b64" ;; 3) printf '=' >> "$TMP/sig.b64" ;; esac
openssl base64 -d -A < "$TMP/sig.b64" > "$TMP/sig.bin" 2>/dev/null || die 'the signature is not readable, so nothing was installed.'
[ "$(wc -c < "$TMP/sig.bin" | tr -d ' ')" = 64 ] || die 'the signature is not the right size, so nothing was installed.'
openssl pkeyutl -verify -rawin -pubin -inkey "$TMP/pub.pem" -in "$TMP/digest.bin" -sigfile "$TMP/sig.bin" >/dev/null 2>&1 || die 'the download is not signed by a key Centcom trusts, so nothing was installed.'

# --- only now is anything unpacked or moved
case "$EXT" in tar.gz) mkdir "$TMP/x" && tar -xzf "$TMP/$ARCHIVE" -C "$TMP/x" || die 'the archive could not be unpacked, so nothing was installed.' ;; *) die 'Windows archives are installed with install.ps1.' 1 ;; esac
BIN=$(find "$TMP/x" -type f -name centcom | head -n 1); [ -n "$BIN" ] || die 'the archive has no centcom program, so nothing was installed.'
mkdir -p "$DIR" || die "cannot create $DIR"
cp "$BIN" "$DIR/.centcom.new" && chmod 755 "$DIR/.centcom.new" && mv -f "$DIR/.centcom.new" "$DIR/centcom" || { rm -f "$DIR/.centcom.new"; die "cannot write to $DIR"; }
[ "$(uname -s)" = Darwin ] && xattr -d com.apple.quarantine "$DIR/centcom" 2>/dev/null || true # only for the file just verified
printf 'Installed centcom %s to %s\n' "$VERSION" "$DIR"
case ":$PATH:" in *":$DIR:"*) ;; *)
  if [ "$MODIFY_PATH" = 1 ]; then rc="$HOME/.profile"; printf '\nexport PATH="%s:$PATH"\n' "$DIR" >> "$rc"; printf 'Added %s to PATH in %s\n' "$DIR" "$rc"
  else printf 'Add %s to your PATH to run it (or run the installer again with --modify-path).\n' "$DIR"; fi ;;
esac
