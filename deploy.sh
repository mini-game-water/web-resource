#!/bin/bash
set -euo pipefail

REPO="https://github.com/mini-game-water/web-resource.git"
APP_DIR="/home/ec2-user/app"
CONTAINER="gamehub"
IMAGE="gamehub:latest"

# ── Stop & remove old container ──
echo ">> Stopping old container..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

# ── Fresh clone ──
echo ">> Cloning repo..."
rm -rf "$APP_DIR"
cd /home/ec2-user
git clone "$REPO" app
cd "$APP_DIR"

# ── Build image ──
echo ">> Building Docker image..."
docker build -t "$IMAGE" .

# ── Run new container ──
echo ">> Starting new container..."
docker run -d \
  --name "$CONTAINER" \
  --restart always \
  -p 5000:5000 \
  -e AWS_REGION=us-east-1 \
  -e USERS_TABLE=gamehub-users \
  -e ROOMS_TABLE=gamehub-rooms \
  -e NOTICES_TABLE=gamehub-notices \
  -e SECRET_KEY='tnqk1234*' \
  -e LOG_BUCKET=gamehub-logs-729403197556 \
  -e LOG_FLUSH_INTERVAL=60 \
  "$IMAGE"

echo ">> Done!"
docker ps --filter "name=$CONTAINER"
