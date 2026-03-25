#!/bin/bash
# deploy-game.sh — Build and deploy game to CommsLink server
#
# Usage: bash scripts/deploy-game.sh "0.0.1" "Initial release"
#   $1 = version string (required)
#   $2 = changelog (optional)

if [ -f "$(dirname "$0")/../.deploy.env" ]; then
  source "$(dirname "$0")/../.deploy.env"
fi

PEM="${DEPLOY_PEM:?Set DEPLOY_PEM}"
EC2="${DEPLOY_PROD_EC2:?Set DEPLOY_PROD_EC2}"
BUILD_DIR="${GAME_BUILD_DIR:-H:/Development/UnitX1/Build}"

VERSION="${1:?Usage: deploy-game.sh VERSION [CHANGELOG]}"
CHANGELOG="${2:-}"

echo "========================================="
echo "  Game Deploy v${VERSION}"
echo "  Build dir: ${BUILD_DIR}"
echo "========================================="

# Check build exists
if [ ! -d "$BUILD_DIR" ]; then
  echo "ERROR: Build directory not found: $BUILD_DIR"
  echo "Build your Unity project first!"
  exit 1
fi

# Zip the build
echo "[1/4] Zipping build..."
TEMP_ZIP="/tmp/game-build-${VERSION}.zip"
cd "$BUILD_DIR" && zip -r "$TEMP_ZIP" . -x "*.pdb" "*_BurstDebugInformation_DoNotShip*" > /dev/null 2>&1
ZIP_SIZE=$(stat -c%s "$TEMP_ZIP" 2>/dev/null || stat -f%z "$TEMP_ZIP" 2>/dev/null)
echo "  Zip: $(echo "scale=1; $ZIP_SIZE / 1048576" | bc)MB"

# Upload to EC2 nginx directory
echo "[2/4] Uploading to EC2..."
scp -i "$PEM" "$TEMP_ZIP" "${EC2}:/var/www/commslink/game/build.zip"

# Upload to API data directory too
ssh -i "$PEM" "${EC2}" "mkdir -p ~/CommsLink2/data/game-releases"
scp -i "$PEM" "$TEMP_ZIP" "${EC2}:~/CommsLink2/data/game-releases/latest.zip"

# Write version.json
echo "[3/4] Updating version info..."
SHA256=$(sha256sum "$TEMP_ZIP" | cut -d' ' -f1)
ssh -i "$PEM" "${EC2}" "cat > ~/CommsLink2/data/game-releases/version.json << VJSON
{
  \"version\": \"${VERSION}\",
  \"changelog\": \"${CHANGELOG}\",
  \"sha256\": \"${SHA256}\",
  \"size\": ${ZIP_SIZE},
  \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
}
VJSON"

# Cleanup
echo "[4/4] Cleanup..."
rm -f "$TEMP_ZIP"

echo ""
echo "========================================="
echo "  Game v${VERSION} deployed!"
echo "  Download: https://commslink.net/game/build.zip"
echo "  Version:  https://commslink.net/api/v1/game/version"
echo "========================================="
