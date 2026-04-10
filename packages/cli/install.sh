#!/bin/sh
# easl CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/AdirAmsalem/easl/main/packages/cli/install.sh | sh
set -eu

REPO="AdirAmsalem/easl"
BINARY_NAME="easl"
INSTALL_DIR="${EASL_INSTALL_DIR:-$HOME/.local/bin}"

# --- Colors ---

if [ -t 1 ]; then
  tty_bold="$(printf '\033[1m')"
  tty_green="$(printf '\033[32m')"
  tty_yellow="$(printf '\033[33m')"
  tty_red="$(printf '\033[31m')"
  tty_reset="$(printf '\033[0m')"
else
  tty_bold="" tty_green="" tty_yellow="" tty_red="" tty_reset=""
fi

info()  { printf '%s[info]%s %s\n' "$tty_bold" "$tty_reset" "$1"; }
warn()  { printf '%s[warn]%s %s\n' "$tty_yellow" "$tty_reset" "$1"; }
error() { printf '%s[error]%s %s\n' "$tty_red" "$tty_reset" "$1" >&2; exit 1; }

# --- Platform Detection ---

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    *)      error "Unsupported OS: $OS. Only macOS and Linux are supported." ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             error "Unsupported architecture: $ARCH" ;;
  esac

  # Rosetta 2 detection: if reporting x64 on macOS but hw is arm64, use arm64
  if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
    if sysctl -n sysctl.proc_translated 2>/dev/null | grep -q 1; then
      info "Rosetta 2 detected — downloading native arm64 binary"
      ARCH="arm64"
    fi
  fi
}

# --- Version Resolution ---

resolve_version() {
  if [ -n "${EASL_VERSION:-}" ]; then
    VERSION="$EASL_VERSION"
    info "Using specified version: $VERSION"
    return
  fi

  info "Fetching latest version..."
  # The repo has multiple release types (cli@*, mcp@*), filter for cli@ tags
  VERSION=$(
    curl -fsSL "https://api.github.com/repos/$REPO/releases" \
      | grep '"tag_name"' \
      | grep '"cli@' \
      | head -1 \
      | sed -E 's/.*"cli@([^"]+)".*/\1/'
  ) || error "Failed to fetch latest version from GitHub"

  if [ -z "$VERSION" ]; then
    error "Could not determine latest version. Set EASL_VERSION to install a specific version."
  fi

  info "Latest version: $VERSION"
}

# --- Download & Install ---

install() {
  TARGET="${BINARY_NAME}-${PLATFORM}-${ARCH}"
  TAG="cli@${VERSION}"
  URL="https://github.com/$REPO/releases/download/$TAG/$TARGET.tar.gz"

  TMPDIR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR"' EXIT

  info "Downloading $TARGET.tar.gz..."
  curl -fsSL "$URL" -o "$TMPDIR/$TARGET.tar.gz" \
    || error "Download failed. Check that version $VERSION exists at:\n  $URL"

  info "Extracting..."
  tar -xzf "$TMPDIR/$TARGET.tar.gz" -C "$TMPDIR" \
    || error "Failed to extract archive"

  # Create install directory
  mkdir -p "$INSTALL_DIR"

  # Move binary into place
  mv "$TMPDIR/$TARGET" "$INSTALL_DIR/$BINARY_NAME" \
    || error "Failed to install binary to $INSTALL_DIR/$BINARY_NAME"
  chmod +x "$INSTALL_DIR/$BINARY_NAME"

  # macOS: remove quarantine attribute
  if [ "$PLATFORM" = "darwin" ]; then
    xattr -d com.apple.quarantine "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || true
  fi
}

# --- PATH Setup ---

setup_path() {
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) return ;;  # already in PATH
  esac

  EXPORT_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""

  warn "$INSTALL_DIR is not in your PATH"

  SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
  RC_FILE=""

  case "$SHELL_NAME" in
    zsh)  RC_FILE="$HOME/.zshrc" ;;
    bash)
      # Prefer .bashrc, fall back to .bash_profile on macOS
      if [ -f "$HOME/.bashrc" ]; then
        RC_FILE="$HOME/.bashrc"
      else
        RC_FILE="$HOME/.bash_profile"
      fi
      ;;
    fish)
      FISH_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/easl.fish"
      mkdir -p "$(dirname "$FISH_CONFIG")"
      printf 'set -gx PATH "%s" $PATH\n' "$INSTALL_DIR" >> "$FISH_CONFIG"
      info "Added $INSTALL_DIR to PATH in $FISH_CONFIG"
      info "Run ${tty_bold}source $FISH_CONFIG${tty_reset} or restart your terminal"
      return
      ;;
  esac

  if [ -n "$RC_FILE" ]; then
    printf '\n# easl CLI\n%s\n' "$EXPORT_LINE" >> "$RC_FILE"
    info "Added $INSTALL_DIR to PATH in $RC_FILE"
    info "Run ${tty_bold}source $RC_FILE${tty_reset} or restart your terminal"
  else
    info "Add the following to your shell config:"
    info "  $EXPORT_LINE"
  fi
}

# --- Verify ---

verify() {
  if [ -x "$INSTALL_DIR/$BINARY_NAME" ]; then
    INSTALLED_VERSION="$("$INSTALL_DIR/$BINARY_NAME" --version 2>/dev/null || echo "unknown")"
    printf '\n%s✓ easl %s installed to %s%s\n' "$tty_green" "$INSTALLED_VERSION" "$INSTALL_DIR/$BINARY_NAME" "$tty_reset"
  else
    error "Installation failed — binary not found at $INSTALL_DIR/$BINARY_NAME"
  fi
}

# --- Main ---

main() {
  detect_platform
  resolve_version
  install
  setup_path
  verify
}

main
