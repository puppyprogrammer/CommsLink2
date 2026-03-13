#!/bin/bash
# deploy.sh — Full deployment from local machine to EC2 production
# Handles: git commit, SCP changed files, docker rebuild, git push
#
# Usage: ./scripts/deploy.sh <services> <commit message>
#   services: api, web, or "api web" (default: api)
#   message:  git commit message (default: auto-generated)
#
# Examples:
#   ./scripts/deploy.sh api "Fix chat handler bug"
#   ./scripts/deploy.sh "api web" "Update frontend and backend"
#   ./scripts/deploy.sh web "New terminal panel UI"
set -e

PEM="H:/Development/AIMMO/PuppyCo.pem"
EC2="ec2-user@3.134.145.169"
REMOTE="~/CommsLink2"

SERVICES="${1:-api}"
MSG="${2:-Deploy: $SERVICES $(date '+%Y-%m-%d %H:%M')}"

echo ""
echo "========================================="
echo "  CommsLink Deploy"
echo "  Services: $SERVICES"
echo "  Message:  $MSG"
echo "========================================="
echo ""

# ── Step 1: Git commit (safety snapshot) ──
echo "[1/5] Git commit (safety snapshot)..."
cd "H:/Development/CommsLink2"

# Stage all tracked changes
CHANGED=$(git diff --name-only 2>/dev/null)
STAGED=$(git diff --cached --name-only 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | head -20)

if [ -z "$CHANGED" ] && [ -z "$STAGED" ] && [ -z "$UNTRACKED" ]; then
  echo "  No changes to commit, skipping git step"
  FILES_TO_UPLOAD=""
else
  # Add all changed files (but not -A to avoid secrets)
  if [ -n "$CHANGED" ]; then
    echo "$CHANGED" | while read -r f; do
      [ -f "$f" ] && git add "$f"
    done
  fi
  if [ -n "$UNTRACKED" ]; then
    echo "$UNTRACKED" | while read -r f; do
      [ -f "$f" ] && git add "$f"
    done
  fi

  git commit -m "$MSG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || true
  echo "  Committed"
fi

# Figure out which files to upload (changed vs last pushed commit)
FILES_TO_UPLOAD=$(git diff --name-only HEAD~1 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")

# ── Step 2: SCP changed files to EC2 ──
echo ""
echo "[2/5] Uploading changed files to EC2..."

if [ -z "$FILES_TO_UPLOAD" ]; then
  echo "  No files to upload"
else
  UPLOAD_COUNT=0
  echo "$FILES_TO_UPLOAD" | while read -r f; do
    if [ -f "$f" ]; then
      DIR=$(dirname "$f")
      ssh -i "$PEM" -o ConnectTimeout=10 "$EC2" "mkdir -p $REMOTE/$DIR" 2>/dev/null
      scp -i "$PEM" -q "$f" "$EC2:$REMOTE/$f"
      echo "  ↑ $f"
    fi
  done
  echo "  Upload complete"
fi

# ── Step 3: Trigger remote deploy (detached) ──
echo ""
echo "[3/5] Starting EC2 build (detached)..."

# Make sure the remote script is executable and up to date
scp -i "$PEM" -q scripts/deploy-ec2.sh "$EC2:$REMOTE/scripts/deploy-ec2.sh"
ssh -i "$PEM" -o ConnectTimeout=10 "$EC2" "chmod +x $REMOTE/scripts/deploy-ec2.sh && nohup $REMOTE/scripts/deploy-ec2.sh $SERVICES > /dev/null 2>&1 &"
echo "  Build started on EC2"

# ── Step 4: Poll for completion ──
echo ""
echo "[4/5] Waiting for EC2 build to complete..."

POLL_COUNT=0
MAX_POLLS=40  # 40 * 15s = 10 minutes max

while true; do
  sleep 15
  POLL_COUNT=$((POLL_COUNT + 1))

  STATUS=$(ssh -i "$PEM" -o ConnectTimeout=10 "$EC2" "tail -1 /tmp/deploy.log 2>/dev/null" 2>/dev/null || echo "")

  if echo "$STATUS" | grep -q "DEPLOY_COMPLETE"; then
    echo "  Build complete!"
    echo ""
    echo "  --- EC2 deploy log ---"
    ssh -i "$PEM" -o ConnectTimeout=10 "$EC2" "cat /tmp/deploy.log" 2>/dev/null || true
    echo "  --- end log ---"
    break
  fi

  if [ $POLL_COUNT -ge $MAX_POLLS ]; then
    echo "  ERROR: Deploy timed out after $((POLL_COUNT * 15))s"
    echo "  Partial log:"
    ssh -i "$PEM" -o ConnectTimeout=10 "$EC2" "cat /tmp/deploy.log" 2>/dev/null || true
    exit 1
  fi

  # Show current status
  LAST_LINE=$(ssh -i "$PEM" -o ConnectTimeout=10 "$EC2" "tail -3 /tmp/deploy.log 2>/dev/null | head -1" 2>/dev/null || echo "waiting...")
  echo "  [$((POLL_COUNT * 15))s] $LAST_LINE"
done

# ── Step 5: Git push ──
echo ""
echo "[5/5] Pushing to GitHub..."
cd "H:/Development/CommsLink2"
git push origin main 2>/dev/null && echo "  Pushed" || echo "  Push failed (or nothing to push)"

echo ""
echo "========================================="
echo "  Deploy complete!"
echo "========================================="
echo ""
