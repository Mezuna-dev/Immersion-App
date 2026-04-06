#!/usr/bin/env bash
# ============================================================
# Build script for Immersion Suite v1.1.0 Linux AppImage
# Run this from the repository root on a Linux machine.
# Requirements:
#   pip install pyinstaller pillow
#   appimagetool on PATH (https://github.com/AppImage/AppImageKit/releases)
#   FUSE or --appimage-extract-and-run environment variable set
# ============================================================

set -euo pipefail

APP_NAME="ImmersionSuite"
APP_VERSION="1.1.0"
OUTPUT_DIR="installer/output"
APPIMAGE_NAME="${APP_NAME}_v${APP_VERSION}_Linux_x86_64.AppImage"

echo "=== Immersion Suite v${APP_VERSION} Linux AppImage Build ==="
echo

# Step 1 — install / verify dependencies
echo "[1/4] Installing Python dependencies..."
pip install -r requirements.txt
pip install pyinstaller pillow

# Step 2 — build the executable bundle with PyInstaller
echo
echo "[2/4] Building executable with PyInstaller..."
pyinstaller ImmersionSuite.spec --noconfirm

# Step 3 — assemble AppDir
echo
echo "[3/4] Assembling AppDir..."
rm -rf AppDir
mkdir -p AppDir

# Copy PyInstaller bundle
cp -r "dist/${APP_NAME}" "AppDir/${APP_NAME}"

# Convert icon.ico -> icon.png using Python Pillow
python3 - <<'PYEOF'
from PIL import Image
img = Image.open("installer/icon.ico")
# Pick the largest available size
sizes = [s for s in img.info.get("sizes", [(256, 256)])]
best = max(sizes) if sizes else (256, 256)
img.size = best
img.save("AppDir/icon.png", format="PNG")
PYEOF

# Desktop entry (paths are relative inside an AppImage)
cat > AppDir/ImmersionSuite.desktop <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Immersion Suite
Comment=Spaced repetition flashcard application
Exec=ImmersionSuite
Icon=icon
Terminal=false
Categories=Education;
StartupWMClass=ImmersionSuite
EOF

# AppRun launcher
cat > AppDir/AppRun <<'EOF'
#!/usr/bin/env bash
SELF=$(readlink -f "$0")
HERE="${SELF%/*}"
exec "${HERE}/ImmersionSuite/ImmersionSuite" "$@"
EOF
chmod +x AppDir/AppRun

# Step 4 — build the AppImage
echo
echo "[4/4] Creating ${APPIMAGE_NAME}..."
mkdir -p "${OUTPUT_DIR}"
ARCH=x86_64 appimagetool AppDir "${OUTPUT_DIR}/${APPIMAGE_NAME}"

echo
echo "=== Build complete ==="
echo "AppImage output: ${OUTPUT_DIR}/${APPIMAGE_NAME}"
echo "To run: chmod +x ${OUTPUT_DIR}/${APPIMAGE_NAME} && ./${OUTPUT_DIR}/${APPIMAGE_NAME}"
