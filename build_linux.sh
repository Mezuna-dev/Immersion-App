#!/usr/bin/env bash
# ============================================================
# Build script for Immersion Suite v1.1.0 Linux package
# Run this from the repository root on a Linux machine.
# Requirements:
#   pip install pyinstaller
#   Standard build tools (tar, gzip)
# ============================================================

set -euo pipefail

APP_NAME="ImmersionSuite"
APP_VERSION="1.1.0"
OUTPUT_DIR="installer/output"
ARCHIVE_NAME="${APP_NAME}_v${APP_VERSION}_Linux_x86_64.tar.gz"

echo "=== Immersion Suite v${APP_VERSION} Linux Build ==="
echo

# Step 1 — install / verify dependencies
echo "[1/3] Installing Python dependencies..."
pip install -r requirements.txt
pip install pyinstaller

# Step 2 — build the executable bundle with PyInstaller
echo
echo "[2/3] Building executable with PyInstaller..."
pyinstaller ImmersionSuite.spec --noconfirm

# Step 3 — package the output directory as a tar.gz archive
echo
echo "[3/3] Packaging dist/${APP_NAME} as ${ARCHIVE_NAME}..."
mkdir -p "${OUTPUT_DIR}"
tar -czf "${OUTPUT_DIR}/${ARCHIVE_NAME}" -C dist "${APP_NAME}"

echo
echo "=== Build complete ==="
echo "Archive output: ${OUTPUT_DIR}/${ARCHIVE_NAME}"
