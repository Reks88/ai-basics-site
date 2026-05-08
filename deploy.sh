#!/bin/bash

# Deploy script for AI Basics site
# Usage: ./deploy.sh

set -e

echo "🚀 Starting deployment..."

# Git commit and push
echo "📝 Committing changes to Git..."
git add .
git commit -m "Deploy: $(date)" || echo "No changes to commit"
git push origin main

# Wait a bit for GitHub Actions to trigger
echo "⏳ Waiting for GitHub Actions deployment..."
sleep 10

echo "✅ Deployment complete!"
echo "🌐 Site should be updated at: https://d35gjncy3cc0uh.cloudfront.net"