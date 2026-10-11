#!/usr/bin/env bash
set -Eeuo pipefail

# Quick deployment script - only deploys to server without pushing to GitHub
# Usage: ./deploy/deploy-quick.sh

SSH_HOST="picup"
SERVER_APP_DIR="${SERVER_APP_DIR:-YOUR_SERVER_APP_DIR}"

echo "🚀 Quick deploying to server..."
echo "SSH Host: $SSH_HOST"
echo "Server Dir: $SERVER_APP_DIR"
echo ""

ssh "$SSH_HOST" "
  set -e
  cd $SERVER_APP_DIR

  echo '🔨 Building and deploying...'
  bash deploy/deploy.sh
"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Deployment completed!"
else
  echo ""
  echo "❌ Deployment failed!"
  exit 1
fi
