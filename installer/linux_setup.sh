#!/usr/bin/env bash
# Runs from the makeself extraction directory.
# Installs Immersion Suite into the user's home directory.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/.local/share/ImmersionSuite/app"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "=== Immersion Suite Installer ==="
echo

echo "Installing to $APP_DIR ..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR" "$ICON_DIR" "$DESKTOP_DIR"

cp -r "$HERE/." "$APP_DIR/"
chmod +x "$APP_DIR/ImmersionSuite"

cp "$HERE/icon.png" "$ICON_DIR/immersionsuite.png"

cat > "$DESKTOP_DIR/ImmersionSuite.desktop" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Immersion Suite
Comment=Spaced repetition flashcard application
Exec=$APP_DIR/ImmersionSuite
Icon=immersionsuite
Terminal=false
Categories=Education;
StartupWMClass=ImmersionSuite
DESKTOP

update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

cat > "$APP_DIR/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env bash
APP_DIR="$HOME/.local/share/ImmersionSuite/app"
rm -rf "$APP_DIR"
rm -f "$HOME/.local/share/applications/ImmersionSuite.desktop"
rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/immersionsuite.png"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Immersion Suite has been uninstalled."
echo "Your data at ~/.local/share/ImmersionSuite/data/ has been preserved."
UNINSTALL
chmod +x "$APP_DIR/uninstall.sh"

echo
echo "=== Installation complete ==="
echo "Launch Immersion Suite from your application menu."
echo
echo "To uninstall: bash $APP_DIR/uninstall.sh"
