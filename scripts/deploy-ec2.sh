#!/bin/bash
# deploy-ec2.sh — Runs ON the EC2 instance (triggered remotely)
# Rebuilds and restarts specified Docker services
# Usage: ./deploy-ec2.sh [api|web|"api web"]
set -e

cd ~/CommsLink2

SERVICES="${@:-api}"
LOG="/tmp/deploy.log"

echo "[deploy] Starting at $(date -u '+%Y-%m-%d %H:%M:%S UTC')" > "$LOG"
echo "[deploy] Services: $SERVICES" >> "$LOG"

# Build
for svc in $SERVICES; do
  echo "[deploy] Building $svc..." >> "$LOG"
  docker-compose -f docker-compose.prod.yml build "$svc" >> "$LOG" 2>&1
done

# Restart
for svc in $SERVICES; do
  echo "[deploy] Restarting $svc..." >> "$LOG"
  docker-compose -f docker-compose.prod.yml up -d "$svc" >> "$LOG" 2>&1
done

# Brief pause for startup
sleep 5

# Capture startup logs
for svc in $SERVICES; do
  echo "=== $svc logs ===" >> "$LOG"
  docker logs "commslink2-$svc" --tail 15 >> "$LOG" 2>&1
done

echo "DEPLOY_COMPLETE" >> "$LOG"
