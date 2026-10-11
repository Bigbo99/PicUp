#!/usr/bin/env bash
set -Eeuo pipefail

# Local SSH deployment script for PicUp
# Usage: ./deploy/deploy-ssh.sh [branch]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Configuration
SSH_HOST="picup"
SERVER_APP_DIR="${SERVER_APP_DIR:-YOUR_SERVER_APP_DIR}"
BRANCH="${1:-main}"

echo "========================================="
echo "  PicUp SSH Deployment"
echo "========================================="
echo "SSH Host: $SSH_HOST"
echo "Server Dir: $SERVER_APP_DIR"
echo "Branch: $BRANCH"
echo "========================================="
echo ""

# Check if there are uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "⚠️  Warning: You have uncommitted changes"
  read -p "Continue deployment anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
  fi
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin "$BRANCH"

# Deploy on server
echo ""
echo "🚀 Deploying on server..."
ssh "$SSH_HOST" "
  set -e
  cd $SERVER_APP_DIR

  echo '📥 Pulling latest code...'
  git fetch origin $BRANCH
  git checkout $BRANCH
  git pull origin $BRANCH

  echo ''
  echo '🔨 Building and deploying...'
  bash deploy/deploy.sh
"

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "✅ Deployment completed successfully!"
  echo "========================================="
else
  echo ""
  echo "========================================="
  echo "❌ Deployment failed!"
  echo "========================================="
  exit 1
fi
